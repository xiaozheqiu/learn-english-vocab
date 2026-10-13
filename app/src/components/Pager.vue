<script setup>
const props = defineProps({
  page: { type: Number, required: true },
  pages: { type: Number, required: true },
  size: { type: Number, required: true },
  total: { type: Number, required: true },
  rowCount: { type: Number, required: true },
  allDone: { type: Boolean, default: false },
  sizes: { type: Array, default: () => [20, 50, 100, 200, 500] },
});

const emit = defineEmits(["update:page", "update:size", "select-page", "nav"]);

function go(p) {
  const n = Math.min(Math.max(1, Math.round(+p) || 1), props.pages || 1);
  if (n === props.page) return;
  emit("update:page", n);
  emit("nav");
}

function onJump(e) {
  go(e.target.value);
  // 输入框始终跟随真实页码，避免留下无效的中间值
  e.target.value = String(props.page);
}

function onSize(e) {
  emit("update:size", +e.target.value);
  emit("nav");
}
</script>

<template>
  <div class="pager">
    <span class="g-nav">
      <button class="btn" :disabled="page <= 1" @click="go(page - 1)">上一页</button>
      <button class="btn" :disabled="page >= pages" @click="go(page + 1)">下一页</button>
      <button
        class="btn"
        :title="`只作用于当前这一页显示的 ${rowCount} 条，不影响其他页`"
        :disabled="!total"
        @click="emit('select-page')"
      >
        {{ allDone ? "取消勾选" : "勾选本页" }}<span class="n">（{{ rowCount }}）</span>
      </button>
    </span>
    <span class="g-meta">
      <span>第</span>
      <input
        class="js-jump"
        type="number"
        min="1"
        :max="pages || 1"
        :value="page"
        @change="onJump"
        @keyup.enter="onJump($event)"
      />
      <span>/ {{ pages || 1 }} 页</span>
      <select class="js-size" :value="size" @change="onSize">
        <option v-for="n in sizes" :key="n" :value="n">每页 {{ n }}</option>
      </select>
      <span class="sp">共 {{ total }} 条</span>
    </span>
  </div>
</template>
