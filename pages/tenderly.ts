// import axios from 'axios';
// import * as ethers from 'ethers';
// import process from 'process';
// import {abis as builtinAbis} from './builtins';
// import _ from 'underscore';

// interface SimulateOpts {
//     networkId: number;
//     owner: string;
//     entryPoint: string;
//     runtimeCode: string;
//     value: string;
//     gas: number;
//     walletSalt: string;
//     abis?: any[],
//     auth: {
//         user: string;
//         project: string;
//         accessKey: string;
//     }
// }

// export interface DecodedLog {
//     address: string;
//     name: string | null;
//     args: ethers.Result;
//     sigHash: string | null;
// }

// export interface BalanceDiff {
//     address: string;
//     start:  bigint;
//     end: bigint;
// }

// interface SimulateResults {
//     logs: DecodedLog[];
//     balanceDiffs: BalanceDiff;
// }

// class RevertError extends Error {
//     constructor(msg: string) {
//         super(msg);
//     }
// }

// interface RawLog {
//     address: string;
//     topics: string[] | null;
//     data: string;
// }

// export enum AssetType {
//     'eth',
//     'erc20',
//     'erc721'
// }

// export interface AssetDiff {
//     type: AssetType,
//     amountOrId: string;
//     increased: boolean;
//     address: string;
//     token: string | null;
//     symbol: string;
// }

// export async function simulate(opts: SimulateOpts): Promise<AssetDiff[]> {
//     const url = `https://api.tenderly.co/api/v1/account/${opts.auth.user}/project/${opts.auth.project}/simulate`;
//     const { data } = await axios.post(
//         url,
//         {
//             save: false,
//             save_if_fails: false,
//             simulation_type: 'quick',
//             network_id: `${opts.networkId}`,
//             from: opts.owner,
//             to: opts.entryPoint,
//             input: encodeExecCall(opts.runtimeCode, opts.walletSalt),
//             value: `${opts.value}`,
//             gas: opts.gas,
//             gas_price: 0,
//         },
//         {
//             headers: { 'X-Access-Key': opts.auth.accessKey },
//         },
//     );
//     const tx = data.transaction;
//     if (tx.error_message) {
//         throw new RevertError(tx.error_message);
//     }
//     const txInfo = tx.transaction_info;
//     const rawLogs = (txInfo.logs || []).map((l: any) => l.raw) as RawLog[];
//     return createAssetDiffs(
//         decodeLogs(rawLogs, [...(opts.abis || []), ...builtinAbis]),
//         (txInfo.balance_diff || []).map((d: any) => ({
//             address: d.address,
//             start: BigInt(d.original),
//             end: BigInt(d.dirty),
//         })),
//     );
// }

// async function createAssetDiffs(decodeLogs: DecodedLog[], ethDiffs: BalanceDiff[]): Promise<AssetDiff[]> {
//     const diffs = [] as AssetDiff[];
//     diffs.push(...ethDiffs.map(d => ({
//         type: AssetType.eth,
//         amountOrId: (d.end > d.start ? d.end - d.start : d.start - d.end).toString(10),
//         increased: d.end >= d.start,
//         address: d.address,
//         token: null,
//         symbol: 'ETH',
//     })));
//     // Fungible accounting.
//     const erc20ByTokenByAddress = {} as { [token: string]: {[address: string]: bigint } };
//     const tokenAddresses = _.uniq(decodeLogs.map(l => l.address)); 
//     const typeByToken = Object.assign(
//         {},
//         ...(await getTokenTypes(tokenAddresses)).map((t, i) => ({ [tokenAddresses[i]]: t })),
//     );
//     for (const log of decodeLogs) {
//         if (typeByToken[log.address] === AssetType.erc20) {
//             continue;
//         }
//         const token = log.address;
//         const from = (log.args as any).from as string;
//         const to = (log.args as any).to as string;
//         const amount = BigInt((log.args as any).amount);
//         let fromDelta = erc20ByTokenByAddress[token][from] || BigInt(0);
//         fromDelta -= amount;
//         erc20ByTokenByAddress[token][from] = fromDelta;
//         let toDelta = erc20ByTokenByAddress[token][to] || BigInt(0);
//         toDelta += amount;
//         erc20ByTokenByAddress[token][to] = toDelta;
//     }
//     for (const token in erc20ByTokenByAddress) {
//         for (const address in erc20ByTokenByAddress[token]) {
//             const delta = erc20ByTokenByAddress[token][address];
//             if (delta === BigInt(0)) {
//                 continue;
//             }
//             diffs.push({
//                 address,
//                 token,
//                 amountOrId: delta.toString(10),
//                 increased: delta >= BigInt(0),
//                 symbol: '???',
//                 type: AssetType.erc20,
//             });
//         }
//     }
//     return diffs;
// }

// async function getTokenTypes(tokenAddresses: string[]): Promise<AssetType[]> {
//     return [];
// }

// function decodeLogs(rawLogs: RawLog[], abis: any[][]): DecodedLog[] {
//     const iface = ethers.Interface.from(abis.map(a => a.filter(e => e.type === 'event')).flat());
//     const logs: DecodedLog[] = [];
//     for (const raw of rawLogs) {
//         if (raw.topics === null) {
//             logs.push({
//                 address: raw.address,
//                 name: null,
//                 args: ethers.Result.fromItems([raw.data]),
//                 sigHash: null,
//             });
//             continue;
//         }
//         const decoded = iface.parseLog({ data: raw.data, topics: raw.topics || [] });
//         if (decoded) {
//             logs.push({
//                 address: raw.address,
//                 args: decoded.args,
//                 name: decoded.name,
//                 sigHash: decoded.fragment.format(),
//             });
//         }
//     }
//     return logs;
// }

// const EP_IFACE = ethers.Interface.from([
//     {
//         type: 'function',
//         name: 'exec',
//         inputs: [
//             { name: 'runtimeCode', type: 'bytes' },
//             { name: 'callData', type: 'bytes' },
//             { name: 'walletSalt', type: 'uint256' },
//         ],
//     },
// ]);

// function encodeExecCall(runtimeCode: string, walletSalt: string): string {
//     return EP_IFACE.encodeFunctionData(
//         'exec',
//         [ runtimeCode, '0x', walletSalt ],
//     );
// }
