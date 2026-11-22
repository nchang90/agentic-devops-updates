import { readFileSync } from "node:fs";

export async function publish({ github, context, core, manifest }) {
  const { owner, repo } = context.repo;
  const items = readFileSync(manifest, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const outputs = items.filter((item) => item.type === "create_pull_request");
  if (!outputs.length) {
    core.info("No digest pull request was created.");
    return;
  }
  if (outputs.length !== 1) throw new Error("Expected exactly one digest pull request.");
  const output = outputs[0];
  const sameRepo = output.repo === undefined || output.repo === `${owner}/${repo}`;
  if (sameRepo && Number.isInteger(output.number) && output.number > 0 &&
      output.url === `https://github.com/${owner}/${repo}/issues/${output.number}`) {
    const { data: branch } = await github.rest.repos.getBranch({ owner, repo, branch: "main" });
    if (branch.commit.sha !== context.payload.workflow_run.head_sha &&
        context.payload.workflow_run.event === "schedule") {
      core.warning(`Digest run used an outdated main commit and created ${output.url}; requesting a fresh run.`);
      await github.rest.actions.createWorkflowDispatch({
        owner, repo, workflow_id: "agentic-devops-updates.lock.yml", ref: "main",
      });
      return;
    }
  }
  if (!sameRepo || !Number.isInteger(output.number) || output.number <= 0 ||
      output.url !== `https://github.com/${owner}/${repo}/pull/${output.number}`) {
    throw new Error("Digest pull request was not created; check the agentic workflow safe outputs.");
  }

  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: output.number });
  if (pr.base.ref !== "main" || pr.head.repo?.full_name !== `${owner}/${repo}` ||
      !pr.head.ref.startsWith("agentic-devops-updates/") ||
      !pr.title.startsWith("[Agentic DevOps digest] ") || /\[!CAUTION\]/i.test(pr.body || "")) {
    throw new Error("Digest pull request failed publication checks.");
  }
  const files = await github.paginate(github.rest.pulls.listFiles, {
    owner, repo, pull_number: output.number, per_page: 100,
  });
  if (files.length !== 1 || files[0].filename !== "docs/agentic-devops-releases.html" ||
      files[0].status !== "modified") {
    throw new Error("Digest pull request must modify only the generated page.");
  }
  if (!pr.merged) {
    if (pr.state !== "open" || pr.draft) throw new Error("Digest pull request is not ready to merge.");
    if (pr.base.sha !== context.payload.workflow_run.head_sha) {
      throw new Error("The base branch changed after this digest run; wait for a fresh run.");
    }
    const { data } = await github.rest.pulls.merge({
      owner, repo, pull_number: output.number, sha: pr.head.sha, merge_method: "squash",
    });
    if (!data.merged) throw new Error(`Digest pull request was not merged: ${data.message}`);
  }
  await github.rest.actions.createWorkflowDispatch({
    owner, repo, workflow_id: "deploy.yml", ref: "main",
  });
  core.info("Digest merged and Pages deployment requested.");
}
