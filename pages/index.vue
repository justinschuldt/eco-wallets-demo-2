<template>
  <div class="container flex flex-col justify-center min-h-screen mx-auto">
    <div class="flex flex-col justify-center gap-y-5">
      <div class="flex flex-row space-x-4">
        <span class="text-2xl">👛</span>
        <select class="flex-grow rounded-md bg-blue-200 text-slate-700 font-mono p-2 font-bold">
          <option v-for="(a,i) in addresses" :key="i" :value="a">{{ a }}</option>
        </select>
      </div>
      <textarea id="editor" class="bg-slate-700 text-slate-100 rounded-md p-4" v-model="code"></textarea>
      <div class="flex justify-between">
        <div class="no-outline flex space-x-2 focus:outline-none bg-green-200 rounded-md py-2 px-5 font-bold text-slate-700">
          <input type="number" v-model="ethValue" class="bg-transparent border-transparent" />
          <span>ETH</span>
        </div>
        <button class="bg-yellow-400 rounded-full py-2 px-5 font-bold text-slate-700" :disabled="!runtimeCode">
          Execute
        </button>
      </div>
    </div>
    <div class="justify-center flex mt-8">
      <div v-if="errors" id="errors" class="font-mono text-slate-700 flex">
        <div v-for="e in errors" class="bg-red-100 margin-y-4 rounded-md py-2 px-2">
          {{ e }}
        </div>
      </div>
      <div v-else-if="hasSimulationData" id="simulation" class="flex">
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
import {compile} from './solc';
import _ from 'underscore';

interface AssetDiff {
  type: string;
}

export default Vue.extend({
  components: {
  },
  data: () => ({
    code: 'emit Result(string("Hello, world!"));',
    ethValue: 0,
    addresses: ['0x4D5175EA204954a2CA9Ca06fe766764b196CEDa5', '0x4D5175EA204954a2CA9Ca06fe766764b196CEDa5', '0x4D5175EA204954a2CA9Ca06fe766764b196CEDa5'],
    canExecute: false,
    runtimeCode: null as null | string,
    errors: null as null | string[],
    tokenTransfers: null as null | AssetDiff[],
  }),
  computed: {
    hasSimulationData(): boolean {
      return this.tokenTransfers !== null && this.tokenTransfers.length !== 0;
    }
  },
  mounted() {
    const _recompile = this.recompile;
    this.recompile = _.debounce((code: string) => _recompile(code), 600);
    this.recompile(this.code);
  },
  watch: {
    async code(code: string) {
      this.recompile(code);
    },
  },
  methods: {
    async recompile(code: string) {
      if (process.client) {
        this.runtimeCode = null;
        try {
          const r = await compile(code);
          this.runtimeCode = r;
          this.errors = null;
        } catch (err: any) {
          this.runtimeCode = null;
          this.errors = err.errors;
        }
      }
    }
  }
});

</script>


<style>
.container {
  max-width: 50vw;
}
#editor {
  min-height: 10em;
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
</style>