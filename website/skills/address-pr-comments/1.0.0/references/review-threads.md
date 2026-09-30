# Review threads with the GitHub CLI

Two things the plain commands do not give you: whether a thread is resolved, and how to reply inside a thread.

## Which threads are open

Save this query with fs.write as `threads.graphql` in your workspace:

```
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          isResolved
          isOutdated
          path
          line
          comments(first: 50) {
            nodes { databaseId author { login } body }
          }
        }
      }
    }
  }
}
```

Run it from the project folder (shell.exec), with the pull request's number in place of `<number>`:

```
gh api graphql -F query=@threads.graphql -F owner={owner} -F repo={repo} -F number=<number>
```

- `{owner}` and `{repo}` are filled in by the CLI from the current folder's repository. Type them literally.
- `isResolved: false` is an open thread. `isOutdated: true` means the code under the comment has changed since it was written: read the current file before judging the point.
- The first comment's `databaseId` in a thread is the id you reply to.
- More than 100 threads, or more than 50 comments in one: the list is cut short. Say so, and page through the rest before calling the list complete.

## Reply inside a thread

Outward-facing: only with the Commander's go-ahead.

```
gh api repos/{owner}/{repo}/pulls/<number>/comments/<comment-id>/replies -f body="<your reply>"
```

Then read the thread again to confirm the reply is there. A general (not inline) comment is answered with `gh pr comment <number> --body-file <file>`.

## Through a connected GitHub account instead

Find its tools with tool.search and use the names it returns. If it offers no way to read whether a thread is resolved, treat every thread as open and say so in the report.
