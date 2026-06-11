# Trace replay — playground_issue_graph.json

**20 events · 10 nodes completed · 0 errors · recorded span 857ms**

## Inputs

```json
{
  "title": "First Plant-authored write: hello from the graph",
  "body": "This issue was created by a graph designed by Plant (GPT-4o, pass 1/5) and executed by fractal-node-core's execute-engine through the GitHub MCP server.\n\nGraph: `$input(title, body) + literals(owner, repo) -> pack -> github__create_issue -> $output(issue)`\n\nThis confirms the GitHub *write* path works end-to-end. Created 2026-06-10."
}
```

## Timeline

```
▶ $input
✓ $input (1ms)
▶ owner_const
✓ owner_const (<1ms)
▶ repo_const
✓ repo_const (<1ms)
▶ key1_const
✓ key1_const (<1ms)
▶ key2_const
✓ key2_const (<1ms)
▶ key3_const
✓ key3_const (<1ms)
▶ key4_const
✓ key4_const (<1ms)
▶ params_pack
✓ params_pack (2ms)
▶ github_create_issue
✓ github_create_issue (847ms)
▶ $output
✓ $output (<1ms)
```

## Outputs

### `issue`

```
{
  "url": "https://api.github.com/repos/OnliestWizard/Plant_Playground/issues/1",
  "repository_url": "https://api.github.com/repos/OnliestWizard/Plant_Playground",
  "labels_url": "https://api.github.com/repos/OnliestWizard/Plant_Playground/issues/1/labels{/name}",
  "comments_url": "https://api.github.com/repos/OnliestWizard/Plant_Playground/issues/1/comments",
  "events_url": "https://api.github.com/repos/OnliestWizard/Plant_Playground/issues/1/events",
  "html_url": "https://github.com/OnliestWizard/Plant_Playground/issues/1",
  "id": 4629565438,
  "node_id": "I_kwDOS19Ljs8AAAABE_GP_g",
  "number": 1,
  "title": "First Plant-authored write: hello from the graph",
  "user": {
    "login": "OnliestWizard",
    "id": 210826006,
    "node_id": "U_kgDODJDzFg",
    "avatar_url": "https://avatars.githubusercontent.com/u/210826006?v=4",
    "gravatar_id": "",
    "url": "https://api.github.com/users/OnliestWizard",
    "html_url": "https://github.com/OnliestWizard",
    "followers_url": "https://api.github.com/users/OnliestWizard/followers",
    "following_url": "https://api.github.com/users/OnliestWizard/following{/other_user}",
    "gists_url": "https://api.github.com/users/OnliestWizard/gists{/gist_id}",
    "starred_url": "https://api.github.com/users/OnliestWizard/starred{/owner}{/repo}",
    "subscriptions_url": "https://api.github.com/users/OnliestWizard/subscriptions",
    "organizations_url": "https://api.github.com/users/OnliestWizard/orgs",
    "repos_url": "https://a
… (1631 chars truncated)
```

---

*Rendered by trace-markdown from `playground_issue_trace.json`. The timeline above replays the recorded execution — it is the trace, not a description of it.*
