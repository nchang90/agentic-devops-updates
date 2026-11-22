import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publish } from "./publish-agentic-devops.mjs";

async function run(items, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "digest-publish-"));
  const manifest = join(dir, "items.jsonl");
  writeFileSync(manifest, items.map((item) => JSON.stringify(item)).join("\n"));
  const calls = [];
  const pr = {
    base: { ref: "main", sha: "base" },
    head: { ref: "agentic-devops-updates/refresh", repo: { full_name: "owner/repo" }, sha: "abc" },
    title: "[Agentic DevOps digest] refresh",
    body: "",
    state: "open",
    draft: false,
    merged: false,
    ...overrides.pr,
  };
  const github = {
    rest: {
      pulls: {
        get: async () => ({ data: pr }),
        listFiles: () => {},
        merge: async (args) => { calls.push(["merge", args]); return { data: { merged: true } }; },
      },
      actions: {
        createWorkflowDispatch: async (args) => { calls.push(["dispatch", args]); },
      },
      repos: {
        getBranch: async () => ({ data: { commit: { sha: overrides.mainSha ?? "base" } } }),
      },
    },
    paginate: async () => overrides.files ?? [{ filename: "docs/agentic-devops-releases.html", status: "modified" }],
  };
  try {
    await publish({
      github,
      context: { repo: { owner: "owner", repo: "repo" }, payload: { workflow_run: { head_sha: "base" } } },
      core: { info: () => {}, warning: () => {} },
      manifest,
    });
    return calls;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const output = { type: "create_pull_request", number: 7, url: "https://github.com/owner/repo/pull/7" };

test("merges the generated page at the checked head and dispatches Pages", async () => {
  const calls = await run([output]);
  assert.equal(calls[0][0], "merge");
  assert.equal(calls[0][1].sha, "abc");
  assert.equal(calls[1][0], "dispatch");
  assert.equal(calls[1][1].workflow_id, "deploy.yml");
});

test("retries deployment without merging an already merged digest", async () => {
  const calls = await run([output], { pr: { merged: true, state: "closed" } });
  assert.deepEqual(calls.map(([name]) => name), ["dispatch"]);
});

test("does not publish a fallback issue, extra files, or a caution-marked PR", async () => {
  await assert.rejects(run([{ ...output, url: "https://github.com/owner/repo/issues/7" }]), /not created/);
  await assert.rejects(run([{ ...output, repo: "other/repo" }]), /not created/);
  await assert.rejects(run([{ ...output, url: "https://github.com/other/repo/pull/7" }]), /not created/);
  await assert.rejects(run([{ ...output, number: 0, url: "https://github.com/owner/repo/pull/0" }]), /not created/);
  await assert.rejects(run([output, output]), /exactly one/);
  await assert.rejects(run([output], { files: [{ filename: "other", status: "modified" }] }), /only the generated page/);
  await assert.rejects(run([output], { pr: { body: "> [!CAUTION] Threat detected" } }), /publication checks/);
  await assert.rejects(run([output], { pr: { base: { ref: "main", sha: "newer" } } }), /base branch changed/);
});

test("requests a fresh digest for a fallback issue from an outdated run", async () => {
  const calls = await run([{ ...output, url: "https://github.com/owner/repo/issues/7" }], { mainSha: "newer" });
  assert.deepEqual(calls, [["dispatch", {
    owner: "owner", repo: "repo", workflow_id: "agentic-devops-updates.lock.yml", ref: "main",
  }]]);
  await assert.rejects(run([{ ...output, repo: "other/repo", url: "https://github.com/owner/repo/issues/7" }], { mainSha: "newer" }), /not created/);
});

test("does nothing when no pull request was requested", async () => {
  assert.deepEqual(await run([]), []);
});
