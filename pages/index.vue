<template>
  <div class="container flex flex-col justify-center min-h-screen mx-auto">
    <div class="flex flex-col justify-center gap-y-5">
      <div class="flex flex-row space-x-4">
        <span class="text-2xl">👛</span>
        <select class="flex-grow rounded-md bg-blue-200 text-slate-700 font-mono p-2 font-bold" v-model="walletSalt">
          <option v-for="(a,i) in wallets" :key="i" :value="i">{{ a }}</option>
        </select>
      </div>
      <textarea id="editor" spellcheck="false" class="text-sm bg-slate-700 text-slate-100 rounded-md p-4 font-mono" v-model="code"></textarea>
      <div class="flex justify-between">
        <div class="no-outline flex space-x-2 focus:outline-none bg-green-200 rounded-md py-2 px-5 font-bold text-slate-700">
          <input type="number" v-model="ethValue" class="bg-transparent border-transparent" />
          <span>wei</span>
        </div>
        <button @click="handleExecute()" class="bg-yellow-400 rounded-full py-2 px-5 font-bold text-slate-700" :disabled="!runtimeCode">
          Execute
        </button>
      </div>
    </div>
    <div class="justify-center flex mt-10">
      <div v-if="errors" id="errors" class="font-mono text-slate-700 flex">
        <div v-for="e in errors" class="bg-red-100 margin-y-4 rounded-md py-2 px-2">
          {{ e }}
        </div>
      </div>
      <div v-else-if="runtimeCode" class="flex flex-1">
        <div v-if="isSimulating" class="flex flex-1 justify-center">
          <img src="/tenderly-logo.png" alt="spinner" class="animate-spin" />
        </div>
        <div v-else-if="hasSimulationData" class="flex flex-col flex-1">
          <div class="text-center font-bold text-lg text-slate-600 mb-4">Simulated Results</div>
          <div v-for="diff in balanceDiffs" class="flex flex-row place-content-center justify-center align-center">
            <div v-if="diff.increased" class="flex-1 text-right mr-2">
              <span class="font-mono text-green-600">{{ diff.amountOrId }}</span>
              <span v-if="diff.type === 1">🪙</span>
              <span v-else-if="diff.type === 2">🎨</span>
              <span v-else><img src="/eth.png" class="eth-currency" alt="ETH"/></span>
              <span>{{ diff.symbol }}</span>
              <span class="font-bold">⟶</span>
            </div>
            <div v-else class="flex-1"></div>
            <div class="sim-addr text-ellipsis overflow-hidden flex-initial font-semibold">{{ diff.address }}</div>
            <div v-if="!diff.increased" class="flex-1 text-left ml-2">
              <span class="font-bold">⟶</span>
              <span class="font-mono text-red-600">{{ diff.amountOrId }}</span>
              <span v-if="diff.type === 1">🪙</span>
              <span v-else-if="diff.type === 2">🎨</span>
              <span v-else><img src="/eth.png" class="eth-currency" alt="ETH"/></span>
              <span>{{ diff.symbol }}</span>
            </div>
            <div v-else class="flex-1"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
import {compile} from './solc';
import {AssetDiff, AssetType, simulate} from './tenderly';
import _ from 'underscore';
import * as ethers from 'ethers';
import { EP_ABI } from './builtins';

interface Web3State {
  provider: ethers.providers.Web3Provider;
  ep: ethers.Contract;
  signer: ethers.Signer;
  signerAddress: string;
}

export default Vue.extend({
  components: {
  },
  data: () => ({
    // code: 'IERC20(0x0DD6369417ac3382B065A78f9622B5C7D4891071).transfer(tx.origin, 1); payable(tx.origin).transfer(0);',
    code: `IMintableERC721(0x00a4748f0D0072f65aFe9bb52A723733c5878821).mint{value: 123}(address(this));`,
    ethValue: 123 as number | null,
    walletSalt: 0,
    wallets: [] as string[],
    canExecute: false,
    runtimeCode: null as null | string,
    errors: null as null | string[],
    balanceDiffs: null as null | AssetDiff[],
    resimulateCounter: 0,
    w3: null as null | Web3State,
    isSimulating: false,
    isExecuting: false,
  }),
  computed: {
    hasSimulationData(): boolean {
      return this.balanceDiffs !== null && this.balanceDiffs.length !== 0;
    },
  },
  mounted() {
    if (process.client) {
      const provider = new ethers.providers.Web3Provider((window as any).ethereum);
      provider.send('eth_requestAccounts', []).then(async () => {
        const signer = provider.getSigner();
        const signerAddress = await signer.getAddress();
        const ep = new ethers.Contract(this.$config.ENTRY_POINT, EP_ABI, signer);
        this.w3 = Object.freeze({provider, ep, signer, signerAddress });
        this.fetchWallets();
      });
    }
    const _simulate = this.simulate;
    this.simulate = _.debounce(() => _simulate(), 1000);
    const _recompile = this.recompile;
    this.recompile = _.debounce(() => _recompile(), 600);
    this.recompile();
  },
  watch: {
    async code(code: string | null) {
      this.recompile();
    },
    async ethValue(v: number | null) {
      this.resimulateCounter++;
    },
    async resimulateCounter() {
      this.simulate();
    },
    async walletSalt() {
      this.resimulateCounter++;
    }
  },
  methods: {
    handleExecute() {
      if (this.w3) {
        (async () => {
          this.isExecuting = true;
          try {
            const tx = await this.w3!.ep.exec(this.runtimeCode, '0x', this.walletSalt, {value: this.ethValue});
            const receipt = await tx.wait();
          } catch (err) {
            console.error(err);
          }
          this.isExecuting = false;
        })();
      }
    },
    async fetchWallets() {
      if (this.w3) {
        try {
          this.wallets = (await Promise.all([...new Array(5)].map((__, i) => 
            this.w3!.ep.getWallet(this.w3!.ep.signer.getAddress(), i)
          ))) as string[];
        } catch (err: any) {
          console.error(`unable to fetch wallets:`, err);
        }
      }
    },
    async simulate() {
      this.balanceDiffs = [];
      if (process.client && this.w3 && this.runtimeCode) {
        try {
          this.isSimulating = true;
          const simPromise = simulate({
              networkId: this.$config.NETWORK_ID as any as number,
              owner: this.w3.signerAddress,
              entryPoint: this.$config.ENTRY_POINT as string,
              runtimeCode: this.runtimeCode || '0x',
              value: (this.ethValue || 0).toString(10),
              gas: 1e6,
              walletSalt: this.walletSalt.toString(),
              provider: this.w3!.provider,
              auth: {
                user: this.$config.TENDERLY_USER as string,
                project: this.$config.TENDERLY_PROJECT as string,
                accessKey: this.$config.TENDERLY_ACCESS_KEY as string,
              },
          });
          this.balanceDiffs = await simPromise;
          this.errors = null;
        } catch (err) {
          console.error(err);
          this.errors = ['Transaction would fail!'];
        }
        this.isSimulating = false;
      }
    },
    async recompile() {
      if (process.client) {
        this.runtimeCode = null;
        try {
          const r = await compile(this.code);
          this.runtimeCode = r;
          this.errors = null;
          this.resimulateCounter++;
        } catch (err: any) {
          this.runtimeCode = null;
          this.errors = err.errors;
        }
      }
    }
  }
});

</script>;


<style>
.container {
  max-width: 66vw;
}
#editor {
  min-height: 16em;
}
div:focus[contenteditable] {
  outline: none !important;
}
button[disabled] {
  opacity: 0.33;
}
input:focus {
  outline: none !important;
}
input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.eth-currency {
  width: 0.9em;
  height: 1.25em;
  display: inline;
}
.sim-addr {
  max-width: 16ex;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>