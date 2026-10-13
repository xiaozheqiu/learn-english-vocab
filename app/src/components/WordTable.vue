<script setup>
defineProps({
  rows: { type: Array, required: true },
  done: { type: Set, required: true },
  start: { type: Number, default: 0 },
});

const emit = defineEmits(["toggle"]);

// 移动端用百度翻译的 m 站，桌面端用原来的页面；参数各自不同。
// 移动端不新开标签页：直接在当前页跳走，按返回键能回到原处。
const IS_MOBILE =
  typeof navigator !== "undefined" &&
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
    navigator.userAgent,
  );
const TRANS_DESKTOP = "https://fanyi.baidu.com/mtpe-individual/transText?query=";
const TRANS_MOBILE = "https://fanyi.baidu.com/m/trans?from=en&to=zh&query=";
const qw = (s) => encodeURIComponent(s);
const transUrl = (w) =>
  IS_MOBILE ? TRANS_MOBILE + qw(w) : TRANS_DESKTOP + qw(w) + "&lang=en2zh";
</script>

<template>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>单词</th>
        <th>词性</th>
        <th>中文释义</th>
        <th style="width: 52px">掌握</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(d, i) in rows" :key="d._k" :class="{ done: done.has(d._k) }">
        <td class="num">{{ start + i + 1 }}</td>
        <td class="w">
          <a
            :href="transUrl(d.w)"
            :target="IS_MOBILE ? null : '_blank'"
            :rel="IS_MOBILE ? null : 'noopener'"
            >{{ d.w }}</a
          >
        </td>
        <td class="p">{{ d.p }}<span v-if="d.sc" class="src">{{ d.sc }}</span></td>
        <td class="cn">
          {{ d.cn }}<span v-if="d.sn" class="sn">（{{ d.sn }}）</span>
        </td>
        <td>
          <label class="sw">
            <input
              type="checkbox"
              :checked="done.has(d._k)"
              @change="emit('toggle', d._k)"
            />
            <span></span>
          </label>
        </td>
      </tr>
    </tbody>
  </table>
</template>
