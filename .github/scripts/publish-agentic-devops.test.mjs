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
        createWorkflowDispatch: async (args) => { calls.push(["deploy", args]); },
      },
    },
    paginate: async () => overrides.files ?? [{ filename: "docs/agentic-devops-releases.html", status: "modified" }],
  };
  try {
    await publish({
      github,
      context: { repo: { owner: "owner", repo: "repo" }, payload: { workflow_run: { head_sha: "base" } } },
      core: { info: () => {} },
      manifest,
    });
    return calls;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const output = { type: "create_pull_request", repo: "owner/repo", number: 7, url: "https://github.com/owner/repo/pull/7" };

test("merges the generated page at the checked head and dispatches Pages", async () => {
  const calls = await run([output]);
  assert.equal(calls[0][0], "merge");
  assert.equal(calls[0][1].sha, "abc");
  assert.equal(calls[1][0], "deploy");
  assert.equal(calls[1][1].workflow_id, "deploy.yml");
});

test("retries deployment without merging an already merged digest", async () => {
  const calls = await run([output], { pr: { merged: true, state: "closed" } });
  assert.deepEqual(calls.map(([name]) => name), ["deploy"]);
});

test("does not publish a fallback issue, extra files, or a caution-marked PR", async () => {
  await assert.rejects(run([{ ...output, url: "https://github.com/owner/repo/issues/7" }]), /not created/);
  await assert.rejects(run([output], { files: [{ filename: "other", status: "modified" }] }), /only the generated page/);
  await assert.rejects(run([output], { pr: { body: "> [!CAUTION] Threat detected" } }), /publication checks/);
  await assert.rejects(run([output], { pr: { base: { ref: "main", sha: "newer" } } }), /base branch changed/);
});

test("does nothing when no pull request was requested", async () => {
  assert.deepEqual(await run([]), []);
});
