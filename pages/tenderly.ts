import * as ethers from 'ethers';
import {abis as builtinAbis} from './builtins';
import _ from 'underscore';

interface SimulateOpts {
    networkId: number;
    owner: string;
    entryPoint: string;
    runtimeCode: string;
    value: string;
    gas: number;
    walletSalt: string;
    abis?: any[];
    provider: ethers.providers.Provider;
    auth: {
        user: string;
        project: string;
        accessKey: string;
    },
}

export interface DecodedLog {
    address: string;
    name: string | null;
    args: any;
}

export interface BalanceDiff {
    address: string;
    start:  bigint;
    end: bigint;
}

interface SimulateResults {
    logs: DecodedLog[];
    balanceDiffs: BalanceDiff;
}

class RevertError extends Error {
    constructor(msg: string) {
        super(msg);
    }
}

interface RawLog {
    address: string;
    topics: string[] | null;
    data: string;
}

export enum AssetType {
    eth,
    erc20,
    erc721
}

export interface AssetDiff {
    type: AssetType,
    amountOrId: string;
    increased: boolean;
    address: string;
    token: string | null;
    symbol: string;
    decimals: number;
}

interface TokenMetadata {
    type: AssetType;
    symbol: string;
    decimals: number;
}

const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
const TOKEN_METADATA = {} as {[address: string]: TokenMetadata};

export async function simulate(opts: SimulateOpts): Promise<AssetDiff[]> {
    const url = `https://api.tenderly.co/api/v1/account/${opts.auth.user}/project/${opts.auth.project}/simulate`;
    const r = await fetch(
        url,
        {
            method: 'POST',
            body: JSON.stringify({
                save: false,
                save_if_fails: false,
                simulation_type: 'quick',
                network_id: `${opts.networkId}`,
                from: opts.owner,
                to: opts.entryPoint,
                input: encodeExecCall(opts.runtimeCode, opts.walletSalt),
                value: `${opts.value}`,
                gas: opts.gas,
                gas_price: 0,
            }),
            headers: { 'X-Access-Key': opts.auth.accessKey },
        },
    );
    const data = await r.json() as any;
    const tx = data.transaction;
    if (tx.error_message) {
        console.error(tx.error_message);
        throw new RevertError(tx.error_message);
    }
    const txInfo = tx.transaction_info;
    const rawLogs = (txInfo.logs || []).map((l: any) => l.raw) as RawLog[];
    console.log(rawLogs);
    return createAssetDiffs(
        decodeLogs(rawLogs, [...(opts.abis || []), ...builtinAbis]),
        (txInfo.balance_diff || []).map((d: any) => ({
            address: d.address,
            start: BigInt(d.original),
            end: BigInt(d.dirty),
        })),
        opts.provider,
    );
}

async function createAssetDiffs(
    decodedLogs: DecodedLog[],
    ethDiffs: BalanceDiff[],
    provider: ethers.providers.Provider,
): Promise<AssetDiff[]> {
    console.log('decoded', decodedLogs);
    const diffs = [] as AssetDiff[];
    diffs.push(...ethDiffs.map(d => ({
        type: AssetType.eth,
        amountOrId: (d.end > d.start ? d.end - d.start : d.start - d.end).toString(10),
        increased: d.end >= d.start,
        address: d.address,
        token: null,
        symbol: 'ETH',
        decimals: 18,
    })));
    const tokenAddresses = _.uniq(decodedLogs.map(l => l.address)); 
    await populateTokenMetadata(tokenAddresses, provider);
    {
        const erc20Tokens = tokenAddresses.filter(a => TOKEN_METADATA[a].type === AssetType.erc20);
        // Fungible accounting.
        const erc20ByTokenByAddress = Object.assign({},
            ...erc20Tokens.map(t => ({[t]: {} }))
        ) as { [token: string]: {[address: string]: bigint } };
        for (const log of decodedLogs) {
            if (TOKEN_METADATA[log.address].type !== AssetType.erc20) {
                continue;
            }
            if (log.name !== 'Transfer') {
                continue;
            }
            const token = log.address;
            const from = log.args[0] as string;
            const to = log.args[1] as string;
            const amount = BigInt(log.args[2]);
            let fromDelta = erc20ByTokenByAddress[token][from] || BigInt(0);
            fromDelta -= amount;
            erc20ByTokenByAddress[token][from] = fromDelta;
            let toDelta = erc20ByTokenByAddress[token][to] || BigInt(0);
            toDelta += amount;
            erc20ByTokenByAddress[token][to] = toDelta;
        }
        for (const token in erc20ByTokenByAddress) {
            for (const address in erc20ByTokenByAddress[token]) {
                const delta = erc20ByTokenByAddress[token][address];
                if (delta === BigInt(0)) {
                    continue;
                }
                if (address === NULL_ADDRESS) {
                    continue;
                }
                diffs.push({
                    address,
                    token,
                    amountOrId: (delta > BigInt(0) ? delta : -delta).toString(10),
                    increased: delta >= BigInt(0),
                    symbol: TOKEN_METADATA[token].symbol,
                    type: AssetType.erc20,
                    decimals: TOKEN_METADATA[token].decimals,
                });
            }
        }
    }
    {
        // NFT accounting.
        const erc721Tokens = tokenAddresses.filter(a => TOKEN_METADATA[a].type === AssetType.erc721);
        const nftOwnersTokensByContract = Object.assign({},
            ...erc721Tokens.map(t => ({[t]: {}})),
        ) as { [contract: string]: { [tokenId: string]: { first: string | null; last: string | null; }}};
        for (const log of decodedLogs) {
            if (TOKEN_METADATA[log.address].type !== AssetType.erc721) {
                continue;
            }
            if (log.name !== 'Transfer') {
                continue;
            }
            const from = log.args[0] as string;
            const to = log.args[1] as string;
            const tokenId = (log.args[2] as bigint).toString(10);
            const owners = nftOwnersTokensByContract[log.address][tokenId] = 
                nftOwnersTokensByContract[log.address][tokenId] || {first: null, last: null};
            if (!owners.first && !owners.last) {
                if (from !== NULL_ADDRESS) {
                    owners.first = from;
                }
            }
            if (!owners.last) {
                if (to !== NULL_ADDRESS) {
                    owners.last = to;
                } else {
                    owners.last = null;
                }
            }
        }
        for (const contract in nftOwnersTokensByContract) {
            for (const tokenId in nftOwnersTokensByContract[contract]) {
                const owners = nftOwnersTokensByContract[contract][tokenId];
                if (owners.first === owners.last) {
                    continue;
                }
                const commonFields = {
                    token: contract,
                    amountOrId: `#${tokenId}`,
                    symbol: TOKEN_METADATA[contract].symbol,
                    decimals: 1,
                    type: AssetType.erc721,
                };
                if (owners.first) {
                    diffs.push({
                        ...commonFields,
                        address: owners.first!,
                        increased: false,
                    });
                }
                if (owners.last) {
                    diffs.push({
                        ...commonFields,
                        address: owners.last!,
                        increased: true,
                    });
                }
            }
        }
    }
    return diffs;
}

const TOK_ABI = [
    {
        name: 'isApprovedForAll',
        type: 'function',
        stateMutability: 'view',
        inputs: [ { type: 'address' }, { type: 'address' } ],
        outputs: [ { type: 'bool' } ],
    },
    {
        name: 'symbol',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [ { type: 'string' } ],
    },
    {
        name: 'decimals',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [ { type: 'uint8' } ],
    },
];

async function populateTokenMetadata(
    tokenAddresses: string[],
    provider: ethers.providers.Provider,
) {
    const c = new ethers.Contract(NULL_ADDRESS, TOK_ABI, provider);
    Object.assign(
        TOKEN_METADATA,
        ...await (Promise.all(tokenAddresses.filter(a => !TOKEN_METADATA[a]).map(async a => {
            const _c = c.attach(a);
            const [type, symbol, decimals] = await Promise.all([
                (async () => {
                    try {
                        await _c.isApprovedForAll(
                            '0x0000000000000000000000000000000000000001',
                            '0x0000000000000000000000000000000000000001',
                        );
                        return AssetType.erc721;
                    } catch {
                        return AssetType.erc20;
                    }
                })(),
                (async () => {
                    try {
                        return (await _c.symbol()) as string;
                    } catch {
                        return '???';
                    }
                })(),
                (async () => {
                    try {
                        return (await _c.decimals()) as number;
                    } catch {
                        return 18;
                    }
                }),
            ]);
            return { [a]: {type, symbol, decimals} };
        }))),
    );
}

function decodeLogs(rawLogs: RawLog[], abis: any[][]): DecodedLog[] {
    const ifaces = abis.map(a => new ethers.utils.Interface(a));
    const logs: DecodedLog[] = [];
    for (const raw of rawLogs) {
        if (raw.topics === null) {
            logs.push({
                address: raw.address,
                name: null,
                args: [raw.data],
            });
            continue;
        }
        for (const iface of ifaces) {
            try {
                const decoded = iface.parseLog({ data: raw.data, topics: raw.topics || [] });
                if (decoded) {
                    logs.push({
                        address: raw.address,
                        args: decoded.args,
                        name: decoded.name,
                    });
                }
                break;
            } catch (err) {}
        }
    }
    return logs;
}

const EP_IFACE = new ethers.utils.Interface([
    {
        type: 'function',
        name: 'exec',
        stateMutability: 'payable',
        inputs: [
            { name: 'runtimeCode', type: 'bytes' },
            { name: 'callData', type: 'bytes' },
            { name: 'walletSalt', type: 'uint256' },
        ],
    },
]);

function encodeExecCall(runtimeCode: string, walletSalt: string): string {
    return EP_IFACE.encodeFunctionData(
        'exec',
        [ runtimeCode, '0x', walletSalt ],
    );
}
