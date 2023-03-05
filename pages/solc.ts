import * as builtins from './builtins';

export interface CompilerInput {
    language: string,
    sources: {
        [name: string]: {
            content: string;
        };
    };
    settings: {
        optimizer: {
            enabled: boolean;
            runs: number;
        };
        viaIR?: boolean;
        outputSelection: {
            [file: string]: {
                [contract: string]: string[];
            };
        };
    };
}

export interface CompilerOutput {
    errors?: Array<
        {
            sourceLocation: {
                file: string;
                start: number;
                end: number;
            };
            type: string;
            severity: 'error' | 'warning' | 'info';
            errorCode: number;
            message: string;
            formattedMessage: string;
        }
    >;
    contracts: {
        [file: string]: {
            [contract: string]: {
                abi: any[];
                evm: { deployedBytecode: { object: string; }; };            
            };
        };
    };
}

export interface CompileOpts {
    version: string;
    fragment: string;
}

export class CompileError extends Error {
    public readonly errors: string[];

    constructor(errors: string[]) {
        super('compiler errors');
        this.errors = errors;
    }
}

export async function compile(fragment: string): Promise<string> {
    const input: CompilerInput = {
        language: 'Solidity',
        sources: { 'main': { content: createContract(fragment) } },
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
            outputSelection: {
                'main': { ['WalletOperation__']: ['evm.deployedBytecode.object', 'abi'] },
            },
        },
    };
    return new Promise((accept, reject) => {
        const worker = new Worker('/compile.worker.js');
        worker.onmessage = ({ data }) => {
            const o = data as CompilerOutput;
            if ((o.errors || []).filter(e => e.severity === 'error').length) {
                return reject(new CompileError(o.errors?.map(e => e.formattedMessage) || []));
            }
            accept('0x' + o.contracts['main']['WalletOperation__'].evm.deployedBytecode.object);
        };
        worker.postMessage({
            soljson: 'https://binaries.soliditylang.org/bin/soljson-v0.8.19+commit.7dd6d404.js',
            input,
        });
    });
}

export function createContract(fragment: string): string {
    return `// SPDX-License-Identifier: UNLICENSED
        pragma solidity 0.8.19;

        ${(builtins.outerDefs || []).join('\n')}

        contract WalletOperation__ {

            ${(builtins.innerDefs || []).join('\n')}

            fallback() external payable {
                ${fragment}
            }
        }
    `;
}
