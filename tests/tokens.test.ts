import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const norm = (value: string) => value.replace(/\s+/g, " ").trim();
const md = read("docs/design.md");
const srcFiles = readdirSync(join(root, "src"), { recursive: true, encoding: "utf8" });

// Token rows of design.md §2.1–2.4: | `--name` | `light` | `dark` | …
function specTokens() {
  const section = md.slice(md.indexOf("### 2.1 "), md.indexOf("### 2.5 "));
  const rows = [...section.matchAll(/^\| `(--[\w-]+)` \| `([^`]+)` \| `([^`]+)` \|/gm)];
  return rows.map(([, name, light, dark]) => ({ name, light: norm(light), dark: norm(dark) }));
}

const css = read("src/styles/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");

// Declarations of the first rule whose selector is exactly `selector`.
function block(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|[\\s{}])${escaped}\\s*\\{([^{}]*)\\}`));
  if (!match) throw new Error(`no block for ${selector}`);
  const decls = new Map<string, string>();
  for (const decl of match[1].split(";")) {
    const i = decl.indexOf(":");
    if (i === -1) continue;
    decls.set(decl.slice(0, i).trim(), norm(decl.slice(i + 1)));
  }
  return decls;
}

const tokens = specTokens();
const light = block(":root");
const darkMedia = block(':root:not([data-theme="light"])');
const darkAttr = block(':root[data-theme="dark"]');

describe("design tokens (design.md §2.1–2.4)", () => {
  it("reads all 40 token rows from design.md", () => {
    expect(tokens).toHaveLength(40);
  });

  it("dark media block sits inside prefers-color-scheme: dark", () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{/);
  });

  it.each(tokens)("$name has the spec light value on :root", ({ name, light: value }) => {
    expect(light.get(name)).toBe(value);
  });

  it.each(tokens)("$name has the spec dark value in both dark blocks", ({ name, dark: value }) => {
    expect(darkMedia.get(name)).toBe(value);
    expect(darkAttr.get(name)).toBe(value);
  });

  // A fourth declaration would override the spec value in one theme.
  it.each(tokens)("$name is declared only in the three token blocks", ({ name }) => {
    expect(css.match(new RegExp(`(?<![\\w-])${name}\\s*:`, "g"))).toHaveLength(3);
  });

  it("both dark blocks are identical", () => {
    expect(Object.fromEntries(darkMedia)).toEqual(Object.fromEntries(darkAttr));
  });

  it("sets color-scheme per theme", () => {
    expect(light.get("color-scheme")).toBe("light");
    expect(darkAttr.get("color-scheme")).toBe("dark");
  });
});

describe("§4 tokens and base rules (design.md §4, P17)", () => {
  const s4 = md.slice(md.indexOf("## 4. "), md.indexOf("## 5. "));
  // Text under `### heading`, up to the next ### heading.
  const sub = (heading: string) => s4.slice(s4.indexOf(`### ${heading}`)).split(/\n### /)[0];
  // Second cell of the table row whose first cell is `label`, without backticks.
  function cell(text: string, label: string) {
    const row = text.split("\n").find((line) => line.startsWith(`| ${label} |`));
    if (!row) throw new Error(`no row ${label}`);
    return norm(row.split("|")[2].replace(/`/g, ""));
  }

  it.each([
    ["`r-xs`", "--r-xs"],
    ["`r-sm`", "--r-sm"],
    ["`r-md`", "--r-md"],
    ["`--radius` (r-lg)", "--radius"],
    ["`r-xl`", "--r-xl"],
    ["`r-full`", "--r-full"],
  ])("radius %s: %s is within its design.md value or range", (label, name) => {
    const [min, max = min] = cell(sub("Border radius"), label).match(/\d+/g)!.map(Number);
    const value = light.get(name);
    expect(value).toMatch(/^\d+px$/);
    expect(parseInt(value!)).toBeGreaterThanOrEqual(min);
    expect(parseInt(value!)).toBeLessThanOrEqual(max);
  });

  it.each([
    ["float", "--shadow-float"],
    ["toast", "--shadow-toast"],
    ["cta-glow", "--shadow-cta"],
  ])("shadow %s equals %s", (label, name) => {
    expect(light.get(name)).toBe(cell(sub("Shadow"), label));
  });

  it("--wrap and --gutter equal the layout table", () => {
    expect(light.get("--wrap")).toBe(cell(sub("Layout"), "`--wrap`").split(" ")[0]);
    expect(light.get("--gutter")).toBe(cell(sub("Layout"), "`--gutter`"));
  });

  it("--ease is the curve of the slow motion row", () => {
    expect(light.get("--ease")).toBe(cell(sub("Motion"), "slow").replace(/^\S+ /, ""));
  });

  it("--burst is the §4 starburst polygon", () => {
    expect(light.get("--burst")).toBe(norm(sub("Shape: starburst").match(/polygon\([^)]*\)/)![0]));
  });

  it("html and body base rules", () => {
    const html = block("html");
    const body = block("body");
    expect(html.get("background")).toBe("var(--bg)");
    expect(html.get("color")).toBe("var(--ink)");
    expect(body.get("font-family")).toBe("var(--body)");
    expect(body.get("-webkit-font-smoothing")).toBe("antialiased");
  });
});

describe("theme script (M0.2 note 5)", () => {
  it("dangerouslySetInnerHTML appears once in src/, in the root layout", () => {
    const hits = srcFiles
      .filter((f) => /\.[jt]sx?$/.test(f))
      .flatMap((f) => (read(join("src", f)).match(/dangerouslySetInnerHTML/g) ?? []).map(() => f));
    expect(hits).toEqual([join("app", "layout.tsx")]);
  });
});

// CSS named colors (CSS Color 4, 148). transparent and currentColor are allowed, so they are not listed.
const NAMED_COLORS =
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood " +
  "cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray " +
  "darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
  "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue " +
  "firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew " +
  "hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
  "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
  "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue " +
  "mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred " +
  "midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
  "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple " +
  "rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue " +
  "slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white " +
  "whitesmoke yellow yellowgreen";
// The lookarounds keep token names such as var(--blue) from matching.
const colorLiteral = new RegExp(
  String.raw`#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(|(?<![\w-])(?:${NAMED_COLORS.replace(/ /g, "|")})(?![\w-])`,
  "i",
);

// D18: alpha of a token is allowed, written exactly as color-mix(in srgb, var(--token) N%, transparent).
const tokenAlpha = /color-mix\(\s*in srgb\s*,\s*var\(--[\w-]+\)\s+\d+(?:\.\d+)?%\s*,\s*transparent\s*\)/gi;

// design.md §2.7: the WhatsApp bubble's two colors, allowed as literals only in the module that draws the bubble.
const BUBBLE_MODULE = join("components", "OrderResult.module.css");
const bubbleColors = (() => {
  const s27 = md.slice(md.indexOf("### 2.7 "), md.indexOf("## 3. "));
  const row = s27.split("\n").find((line) => line.includes("WhatsApp message preview bubble"));
  if (!row) throw new Error("no WhatsApp bubble row in design.md §2.7");
  return [...row.matchAll(/`(#[0-9a-f]{3,8})`/gi)].map((m) => m[1].toLowerCase());
})();

/** The color literals a CSS module's declaration values hold, after the D18 exceptions for `file`. */
function cssLiterals(file: string, source: string) {
  const allowed = file === BUBBLE_MODULE ? bubbleColors : [];
  // Declaration values only, so a selector such as .white is not a hit.
  const values = [...source.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/:\s*([^;{}]+)(?=[;}])/g)].map((m) => m[1]);
  return values
    .map((v) => v.replace(tokenAlpha, "").replace(/#[0-9a-f]{3,8}\b/gi, (hex) => (allowed.includes(hex.toLowerCase()) ? "" : hex)))
    .filter((v) => colorLiteral.test(v));
}

describe("components reference tokens only (design.md §2)", () => {
  const modules = srcFiles.filter((f) => f.endsWith(".module.css"));
  const components = srcFiles.filter((f) => f.endsWith(".tsx"));

  it("finds the CSS modules and components", () => {
    expect(modules.length).toBeGreaterThan(0);
    expect(components.length).toBeGreaterThan(0);
  });

  it.each(modules)("src/%s has no color literal", (file) => {
    expect(cssLiterals(file, read(join("src", file)))).toEqual([]);
  });

  // SVG paint attributes and color properties of style objects.
  it.each(components)("src/%s has no color literal in paint attributes or styles", (file) => {
    const paint =
      /\b(?:fill|stroke|stopColor|floodColor|lightingColor|color|background(?:Color)?|border\w*Color|outlineColor|caretColor|accentColor|textDecorationColor|boxShadow|textShadow)\s*[=:]\s*\{?\s*(["'`])(.*?)\1/g;
    const values = [...read(join("src", file)).matchAll(paint)].map((m) => m[2]);
    expect(values.filter((v) => colorLiteral.test(v))).toEqual([]);
  });
});

describe("D18 exceptions (milestone plan §4.8)", () => {
  const other = join("components", "Field.module.css");

  it("reads the two bubble colors from design.md §2.7", () => {
    expect(bubbleColors).toEqual(["#dcf8c6", "#111b21"]);
  });

  it("the bubble module exists, so the allow-list points at a real file", () => {
    expect(srcFiles).toContain(BUBBLE_MODULE);
  });

  it.each([
    ["alpha of a token", ".a { box-shadow: 0 0 0 3px color-mix(in srgb, var(--link) 22%, transparent); }"],
    ["alpha of a token, decimal percent", ".a { border-color: color-mix(in srgb, var(--ink) 7.5%, transparent); }"],
  ])("accepts %s", (_, source) => {
    expect(cssLiterals(other, source)).toEqual([]);
  });

  it.each(bubbleColors)("accepts §2.7 %s in the bubble module", (hex) => {
    expect(cssLiterals(BUBBLE_MODULE, `.b { background: ${hex}; }`)).toEqual([]);
  });

  it.each([
    ["a §2.7 bubble color in another module", other, ".a { background: #dcf8c6; }"],
    ["the other §2.7 bubble color in another module", other, ".a { color: #111B21; }"],
    ["a non-§2.7 literal in the bubble module", BUBBLE_MODULE, ".b { background: #dcf8c7; }"],
    ["a named color in the bubble module", BUBBLE_MODULE, ".b { color: white; }"],
    ["color-mix with a literal color", other, ".a { color: color-mix(in srgb, #ff0000 20%, transparent); }"],
    ["color-mix of a token with a literal instead of transparent", other, ".a { color: color-mix(in srgb, var(--ink) 20%, white); }"],
    ["color-mix of two tokens", other, ".a { color: color-mix(in srgb, var(--ink) 20%, var(--bg)); }"],
    ["color-mix in another color space", other, ".a { color: color-mix(in oklch, var(--ink) 20%, transparent); }"],
  ])("rejects %s", (_, file, source) => {
    expect(cssLiterals(file, source)).not.toEqual([]);
  });
});
