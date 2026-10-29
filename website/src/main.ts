import "./style.css";

const root = document.documentElement.dataset.root ?? "./";
const menu = document.querySelector<HTMLButtonElement>(".menu-button")!;
const shade = document.querySelector<HTMLElement>(".sidebar-shade")!;
const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
const mobile = window.matchMedia("(max-width: 700px)");
sidebar.inert = mobile.matches;
function closeMenu() {
  const wasOpen = document.body.classList.contains("menu-open");
  document.body.classList.remove("menu-open");
  menu.setAttribute("aria-expanded", "false");
  shade.hidden = true;
  sidebar.inert = mobile.matches;
  if (wasOpen && mobile.matches) menu.focus();
}
menu.addEventListener("click", () => {
  const opened = document.body.classList.toggle("menu-open");
  menu.setAttribute("aria-expanded", String(opened));
  shade.hidden = !opened;
  sidebar.inert = mobile.matches && !opened;
});
mobile.addEventListener("change", closeMenu);
shade.addEventListener("click", closeMenu);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});

async function copy(button: HTMLButtonElement, value: string) {
  const before = button.textContent;
  try {
    await navigator.clipboard.writeText(value);
    button.textContent = "Copied!";
  } catch {
    button.textContent = "Select & copy";
  }
  setTimeout(() => {
    button.textContent = before;
  }, 1800);
}
document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) =>
  button.addEventListener("click", () => {
    void copy(button, button.dataset.copy!);
  }),
);
document.querySelectorAll<HTMLButtonElement>(".copy-code").forEach((button) =>
  button.addEventListener("click", () => {
    void copy(
      button,
      button.closest(".code-block")!.querySelector("code")!.textContent!,
    );
  }),
);
// Keep wide API tables contained without shrinking the rest of the article.
document.querySelectorAll(".article table").forEach((table) => {
  const wrapper = document.createElement("div");
  wrapper.className = "table-scroll";
  wrapper.tabIndex = 0;
  wrapper.setAttribute("role", "region");
  wrapper.setAttribute("aria-label", "Scrollable reference table");
  table.replaceWith(wrapper);
  wrapper.append(table);
});

interface SearchPage {
  title: string;
  slug: string;
  description: string;
  text: string;
}
const dialog = document.querySelector<HTMLDialogElement>(".search-dialog")!;
const input = document.querySelector<HTMLInputElement>("#search-input")!;
const results = document.querySelector<HTMLElement>("#search-results")!;
let pages: SearchPage[] | undefined;
let loading: Promise<void> | undefined;
let selected = -1;
function renderSearch() {
  const terms = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  selected = -1;
  results.replaceChildren();
  if (!pages) {
    results.textContent = "Loading the documentation index…";
    return;
  }
  const ranked = pages
    .map((page) => ({
      page,
      score: terms.reduce(
        (sum, term) => sum + (page.title.toLowerCase().includes(term) ? 10 : 0),
        0,
      ),
    }))
    .filter(({ page }) =>
      terms.every((term) =>
        `${page.title} ${page.text}`.toLowerCase().includes(term),
      ),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 9);
  if (!ranked.length) {
    const p = document.createElement("p");
    p.className = "search-empty";
    p.textContent = `No results for “${input.value}”. Try “snapping”, “undo” or “GeoJSON”.`;
    results.append(p);
    return;
  }
  for (const { page } of ranked) {
    const a = document.createElement("a");
    a.href = `${root}${page.slug}.html`;
    a.className = "search-result";
    const title = document.createElement("strong");
    title.textContent = page.title;
    const description = document.createElement("span");
    description.textContent = page.description;
    a.append(title, description);
    results.append(a);
  }
}
async function openSearch() {
  closeMenu();
  dialog.showModal();
  input.focus();
  renderSearch();
  if (!pages) {
    loading ??= fetch(`${root}search.json`).then(async (response) => {
      if (!response.ok) throw new Error("Index unavailable");
      pages = (await response.json()) as SearchPage[];
    });
    try {
      await loading;
      renderSearch();
    } catch {
      results.textContent =
        "Search is unavailable. You can still browse every guide in the navigation.";
      loading = undefined;
    }
  }
}
document.querySelector(".search-trigger")!.addEventListener("click", () => {
  void openSearch();
});
document.querySelector(".search-close")!.addEventListener("click", () => {
  dialog.close();
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  }
});
input.addEventListener("input", renderSearch);
dialog.addEventListener("keydown", (event) => {
  const links = Array.from(results.querySelectorAll<HTMLAnchorElement>("a"));
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    selected = Math.max(
      0,
      Math.min(
        links.length - 1,
        selected + (event.key === "ArrowDown" ? 1 : -1),
      ),
    );
    links.forEach((link, i) => link.classList.toggle("active", i === selected));
    links[selected]?.scrollIntoView({ block: "nearest" });
  }
  if (event.key === "Enter" && links.length) {
    event.preventDefault();
    links[Math.max(0, selected)].click();
  }
});
document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (
    (event.key === "/" ||
      ((event.metaKey || event.ctrlKey) && event.key === "k")) &&
    !target.matches("input, textarea, [contenteditable], canvas") &&
    !dialog.open
  ) {
    event.preventDefault();
    void openSearch();
  }
});

const tocLinks =
  document.querySelectorAll<HTMLAnchorElement>('.toc a[href^="#"]');
const headings = new IntersectionObserver(
  (entries) => {
    const visible = entries.find((entry) => entry.isIntersecting);
    if (visible)
      tocLinks.forEach((link) =>
        link.classList.toggle("active", link.hash === `#${visible.target.id}`),
      );
  },
  { rootMargin: "-90px 0px -65% 0px" },
);
document.querySelectorAll(".article h2").forEach((h) => headings.observe(h));

const demos = document.querySelectorAll<HTMLElement>("[data-demo]");
if (demos.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          observer.unobserve(entry.target);
          void import("./demo.js")
            .then(({ mountDemo }) => mountDemo(entry.target as HTMLElement))
            .catch(() => {
              entry.target.querySelector(".demo-status")!.textContent =
                "The interactive example could not load. Check WebGL support and reload this page.";
            });
        }
    },
    { rootMargin: "300px" },
  );
  demos.forEach((demo) => observer.observe(demo));
}
