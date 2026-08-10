#!/usr/bin/env node
// Genera apps.json (AltStore Source v2) desde sources.json leyendo los
// GitHub Releases de cada app. Corre en el Action de Zorn.
// Sin release => usa fallbackVersion (source siempre válido).

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = process.env.SOURCE_TOKEN || process.env.GITHUB_TOKEN || "";

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "zorn-source-bot",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  if (res.status === 404) return null; // repo o releases inexistentes
  if (!res.ok) throw new Error(`GitHub ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

function toVersion(release, app) {
  const re = new RegExp(app.assetPattern || "\\.ipa$", "i");
  const asset = (release.assets || []).find((a) => re.test(a.name));
  if (!asset) return null;
  let version = release.tag_name || "";
  if (app.tagPrefix && version.startsWith(app.tagPrefix)) version = version.slice(app.tagPrefix.length);
  version = version.replace(/^v/i, "");
  const body = (release.body || "").trim().split(/\r?\n/)[0] || `Versión ${version}`;
  const published = release.published_at || release.created_at || "";
  return {
    _sort: published,
    version: version || "0.0.0",
    date: published.slice(0, 10),
    localizedDescription: body.slice(0, 400),
    downloadURL: asset.browser_download_url,
    size: asset.size,
    minOSVersion: app.minOSVersion || "16.0",
  };
}

async function buildApp(app) {
  let versions = [];
  if (app.repo) {
    const releases = await gh(`/repos/${app.repo}/releases?per_page=100`);
    if (Array.isArray(releases)) {
      versions = releases
        .filter((r) => !r.draft && !r.prerelease)
        .filter((r) => !app.tagPrefix || (r.tag_name || "").startsWith(app.tagPrefix))
        .map((r) => toVersion(r, app))
        .filter(Boolean)
        .sort((a, b) => (a._sort < b._sort ? 1 : a._sort > b._sort ? -1 : 0));
      versions.forEach((v) => delete v._sort);
    }
  }
  if (versions.length === 0 && app.fallbackVersion) {
    versions = [{ ...app.fallbackVersion, minOSVersion: app.minOSVersion || "16.0" }];
  }
  return {
    name: app.name,
    bundleIdentifier: app.bundleIdentifier,
    developerName: app.developerName,
    subtitle: app.subtitle,
    localizedDescription: app.localizedDescription,
    iconURL: app.iconURL,
    tintColor: app.tintColor,
    category: app.category,
    screenshotURLs: app.screenshotURLs || [],
    versions,
  };
}

const src = JSON.parse(await readFile(join(ROOT, "sources.json"), "utf8"));
const apps = [];
for (const app of src.apps) apps.push(await buildApp(app));

const out = {
  name: src.name,
  identifier: src.identifier,
  subtitle: src.subtitle,
  description: src.description,
  iconURL: src.iconURL,
  headerURL: src.headerURL,
  website: src.website,
  tintColor: src.tintColor,
  featuredApps: src.featuredApps || [],
  apps,
  news: src.news || [],
};

await writeFile(join(ROOT, "apps.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`apps.json generado: ${apps.length} apps, versiones -> ${apps.map((a) => `${a.name}:${a.versions.length}`).join(", ")}`);
