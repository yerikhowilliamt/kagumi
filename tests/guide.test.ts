import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const guide = readFileSync(join(root, "docs/guide.md"), "utf8");

// Folders at column 0 of the code block in guide §6 Project Structure.
function layoutFolders() {
  const section = guide.slice(guide.indexOf("## 6. Project Structure"), guide.indexOf("## 7. "));
  const block = section.split("```")[1];
  return new Set([...block.matchAll(/^([\w.-]+)\//gm)].map(([, name]) => name));
}

describe("developer guide (docs/guide.md §6)", () => {
  it("lists every tracked top-level folder", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
      .split("\0")
      .filter((path) => path.includes("/"))
      .map((path) => path.split("/")[0]);
    const listed = layoutFolders();
    expect([...new Set(tracked)].filter((name) => !listed.has(name))).toEqual([]);
  });
});
