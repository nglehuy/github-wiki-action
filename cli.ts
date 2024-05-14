#!/usr/bin/env -S deno run -Aq
// Copyright 2023 Jacob Hummer
// SPDX-License-Identifier: Apache-2.0
import process from "node:process";
import {
  readFile,
  writeFile,
  appendFile,
  readdir,
  rename,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { copy } from "npm:fs-extra@^11.1.1";
import * as core from "npm:@actions/core@^1.10.0";
import { temporaryDirectory } from "npm:tempy@^3.1.0";
import { $ } from "npm:zx@^7.2.2";
import { remark } from "npm:remark@^14.0.3";
import { visit } from "npm:unist-util-visit@^5.0.0";
import { resolve } from "node:path";

core.startGroup("process.env");
console.table(process.env);
core.endGroup();

const serverURL = core.getInput("github_server_url");
const repo = core.getInput("repository");
const wikiGitURL = `${serverURL}/${repo}.wiki.git`;
const workspacePath = process.cwd();
console.log(workspacePath);
await $`rm -rf ${workspacePath}/.git` // clean .git from source, so that it won't copy
const d = temporaryDirectory();
process.chdir(d);
$.cwd = d;

process.env.GH_TOKEN = core.getInput("token");
process.env.GH_HOST = new URL(core.getInput("github_server_url")).host;

await $`gh auth setup-git`;
await $`git config --global --add safe.directory ${process.cwd()}`;

await $`git init -b master`;
await $`git remote add origin ${wikiGitURL}`;
await $`git fetch`;

// https://github.com/stefanzweifel/git-auto-commit-action/blob/master/action.yml#L35-L42
await $`git config --global user.name github-actions[bot]`;
await $`git config --global user.email 41898282+github-actions[bot]@users.noreply.github.com`;

await appendFile(".git/info/exclude", core.getInput("ignore"));
await copy(resolve(workspacePath, core.getInput("path")), process.cwd());

if (core.getBooleanInput("preprocess")) {
  // https://github.com/nodejs/node/issues/39960
  if (existsSync("README.md")) {
    await rename("README.md", "Home.md");
    console.log("Moved README.md to Home.md");
  }

  const mdRe = /\.(?:md|markdown|mdown|mkdn|mkd|mdwn|mkdown|ron)$/;
  const plugin = () => (tree: any) =>
    visit(tree, ["link", "linkReference"], (node: any) => {
      if (!mdRe.test(node.url)) {
        return;
      }
      if (!new URL(node.url, "file:///-/").href.startsWith("file:///-/")) {
        return;
      }

      const x = node.url;
      node.url = node.url.replace(mdRe, "");
      if (new URL(node.url, "file:///-/").href === "file:///-/README") {
        node.url = "Home";
      }

      console.log(`Rewrote ${x} to ${node.url}`);
    });
  for (const file of await readdir($.cwd!)) {
    if (!mdRe.test(file)) {
      continue;
    }

    let md = await readFile(file, "utf-8");
    md = (await remark().use(plugin).process(md)).toString();
    await writeFile(file, md);
  }
}

await $`ls -al`;
await $`git add -Av`;
await $`git commit --allow-empty -m ${core.getInput("commit_message")}`;

let gitOptions = '';

if (core.getBooleanInput("dry_run")) {
  gitOptions += ' --dry-run';
  await $`git show`;
}

await $`git remote show origin`;
await $`git push -f ${gitOptions} origin master`;

core.setOutput("wiki_url", `${serverURL}/${repo}/wiki`);
