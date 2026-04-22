// ===== 应用核心逻辑 =====

// 窗口控制
document.getElementById('btn-minimize').addEventListener('click', () => {
  window.electronAPI.minimize();
});

document.getElementById('btn-maximize').addEventListener('click', () => {
  window.electronAPI.maximize();
});

document.getElementById('btn-close').addEventListener('click', () => {
  window.electronAPI.close();
});

// 侧边栏导航
const navItems = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.page');

navItems.forEach(item => {
  item.addEventListener('click', () => {
    const targetPage = item.dataset.page;

    // 更新导航高亮
    navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');

    // 切换页面
    pages.forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${targetPage}`).classList.add('active');
  });
});

// 风格选择
const styleBtns = document.querySelectorAll('.style-btn');
styleBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    styleBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // 显示/隐藏自定义输入
    const customInput = document.getElementById('custom-style-input');
    if (btn.dataset.style === 'custom') {
      customInput.style.display = 'block';
    } else {
      customInput.style.display = 'none';
    }
  });
});

// 模式切换
const modeTabs = document.querySelectorAll('.mode-tab');
modeTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    modeTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    document.querySelectorAll('.input-mode').forEach(m => m.classList.remove('active'));
    document.getElementById(`${tab.dataset.mode}-mode`).classList.add('active');
  });
});

// 标签输入
const tagInput = document.getElementById('selling-input');
const tagsContainer = document.getElementById('selling-tags');
let tags = [];

tagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && tagInput.value.trim()) {
    e.preventDefault();
    const value = tagInput.value.trim();
    if (!tags.includes(value)) {
      tags.push(value);
      renderTags();
    }
    tagInput.value = '';
  }
});

function renderTags() {
  tagsContainer.innerHTML = tags.map((tag, i) => `
    <span class="tag">
      ${tag}
      <span class="tag-remove" data-index="${i}">✕</span>
    </span>
  `).join('');

  // 绑定删除事件
  tagsContainer.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      tags.splice(parseInt(btn.dataset.index), 1);
      renderTags();
    });
  });
}
