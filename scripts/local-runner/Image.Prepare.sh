#!/usr/bin/env bash
# Fixed owner-reviewed recipe, executed only inside a disposable credential-free builder VM.
set -euo pipefail
[[ $# == 0 && $(id -u) == 0 ]] || exit 1
exec 3>&1 1>&2
umask 077
inputs=/home/runner/image-inputs
work=/var/tmp/itir-image-build
receipt=/opt/it-inventory-image/receipt.json
[[ $(realpath -- "$inputs") == "$inputs" && ! -e "$work" && ! -e "$receipt" ]] || exit 1
unset SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD NODE_AUTH_TOKEN NPM_TOKEN GH_TOKEN GITHUB_TOKEN
export HOME=/home/runner
export RUNNER_TOOL_CACHE=/opt/hostedtoolcache
export AGENT_TOOLSDIRECTORY="$RUNNER_TOOL_CACHE"
export PLAYWRIGHT_BROWSERS_PATH=/home/runner/.cache/ms-playwright
export npm_config_cache=/home/runner/.npm
mkdir -m 700 "$work"
trap 'rm -rf -- /var/tmp/itir-image-build' EXIT

# Verify every fixed transferred input before running any package lifecycle command.
python3 - "$inputs" <<'PY'
import hashlib,json,pathlib,re,sys
p=pathlib.Path(sys.argv[1]); manifest=json.loads((p/'Image.Inputs.json').read_bytes())
assert manifest['schema']==1 and manifest['platform']=='ubuntu24.04-x64'
assert len(manifest['images'])==11
storage=f"supabase/storage-api:{manifest['storageVersion']}"
aliases=[f"public.ecr.aws/{storage}",f"ghcr.io/{storage}",storage,f"docker.io/{storage}"]
for image in manifest['images']:
    assert image.get('aliases',[]) == (aliases if image['source']==storage else [])
expected={'Image.Prepare.sh','Image.Package.json','Image.PackageLock.json','Image.Supabase.toml'}
assert set(manifest['files'])==expected
for name,digest in manifest['files'].items():
    f=p/name
    assert f.is_file() and not f.is_symlink() and re.fullmatch('[A-F0-9]{64}',digest)
    assert hashlib.sha256(f.read_bytes()).hexdigest().upper()==digest
PY
[[ $(uname -m) == x86_64 ]] || exit 1
. /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]] || exit 1
timeout 600 apt-get update -qq
timeout 900 env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl git openssh-server unzip xz-utils docker.io jq
version=$(jq -er '.node.version' "$inputs/Image.Inputs.json")
url=$(jq -er '.node.url' "$inputs/Image.Inputs.json")
digest=$(jq -er '.node.sha256' "$inputs/Image.Inputs.json")
[[ $version == 24.19.0 && $url == https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz ]] || exit 1
timeout 600 curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$url" -o "$work/node.tar.xz"
printf '%s  %s\n' "$digest" "$work/node.tar.xz" | sha256sum --check --status
tool="$RUNNER_TOOL_CACHE/node/$version/x64"
mkdir -p "$tool"
tar -xJf "$work/node.tar.xz" -C "$tool" --strip-components=1
export PATH="$tool/bin:/usr/sbin:/usr/bin:/sbin:/bin"
[[ $(node --version) == "v$version" ]] || exit 1
timeout 600 npm install --global npm@11.11.0 --no-audit --no-fund
[[ $(npm --version) == 11.11.0 ]] || exit 1
touch "$RUNNER_TOOL_CACHE/node/$version/x64.complete"
mkdir -p "$HOME/.npm" "$PLAYWRIGHT_BROWSERS_PATH" "$work/project"
cp -- "$inputs/Image.Package.json" "$work/project/package.json"
cp -- "$inputs/Image.PackageLock.json" "$work/project/package-lock.json"
chmod 755 "$work"
chown -R runner:runner "$work/project" "$HOME/.npm" /home/runner/.cache "$RUNNER_TOOL_CACHE"
cd "$work/project"
# Populate integrity-protected tarballs only; PR jobs still run a fresh npm ci.
timeout 900 runuser -u runner -- env HOME="$HOME" PATH="$PATH" npm_config_cache="$npm_config_cache" npm ci --ignore-scripts --prefer-offline --no-audit --no-fund
[[ $(node node_modules/supabase/dist/supabase.js --version) == 2.116.0 ]] || exit 1
timeout 900 node node_modules/playwright/cli.js install --with-deps --only-shell chromium
chown -R runner:runner /home/runner/.cache
# Verify the eventual job user can traverse the cache and launch its browser.
runuser -u runner -- env HOME="$HOME" PATH="$PATH" PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" node --input-type=module - "$work/project/browser.json" <<'JS'
import { createRequire } from 'node:module';
import { writeFileSync,readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const require=createRequire(process.cwd()+'/package.json');
const r=require('playwright-core/lib/coreBundle').registry.registry;
const browsers=JSON.parse(readFileSync('node_modules/playwright-core/browsers.json')).browsers;
const records=['chromium-headless-shell','ffmpeg'].map(name=>{
  const executable=r.findExecutable(name); const path=executable.executablePath();
  const revision=browsers.find(b=>b.name===name).revision;
  return {name,revision,path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase()};
});
const {chromium}=require('playwright');
const browser=await chromium.launch(); await browser.close();
writeFileSync(process.argv[2],JSON.stringify(records));
JS
systemctl start docker
[[ -z $(docker ps -aq) && -z $(docker volume ls -q) ]] || exit 1
# Storage runtime may select a different official mirror. Add local aliases to
# the already pulled image ID, without downloading a second mirror's content.
cache_image_aliases() {
  local resolved=$1 image_id alias alias_id separator=''
  shift
  image_id=$(docker image inspect --format '{{.Id}}' "$resolved") || return 1
  [[ $image_id =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
  printf '['
  for alias in "$@"; do
    docker image tag "$image_id" "$alias" >&2 || return 1
    alias_id=$(docker image inspect --format '{{.Id}}' "$alias") || return 1
    [[ $alias_id == "$image_id" ]] || return 1
    printf '%s{"reference":"%s","id":"%s"}' "$separator" "$alias" "$alias_id"
    separator=','
  done
  printf ']'
}
mkdir "$work/images"
index=0
while IFS= read -r image; do
  resolved=''
  while IFS= read -r candidate; do
    if timeout 300 docker pull --platform linux/amd64 "$candidate"; then resolved=$candidate; break; fi
  done < <(printf '%s\n' "$image" | jq -er '.candidates[]')
  [[ -n $resolved ]] || exit 1
  mapfile -t alias_refs < <(printf '%s\n' "$image" | jq -r '.aliases[]?')
  aliases=$(cache_image_aliases "$resolved" "${alias_refs[@]}")
  source=$(printf '%s\n' "$image" | jq -er '.source')
  docker image inspect "$resolved" | jq --arg source "$source" --arg reference "$resolved" --argjson aliases "$aliases" -e '.[0] | {source:$source,reference:$reference,id:.Id,digests:.RepoDigests,size:.Size,aliases:$aliases} | select((.digests|length)>0)' > "$work/images/$index.json"
  index=$((index+1))
done < <(jq -ec '.images[]' "$inputs/Image.Inputs.json")
[[ $(du -sm /var/lib/docker | cut -f1) -le 24576 && $(du -sm /home/runner/.npm | cut -f1) -le 4096 ]] || exit 1
# Pull only: no databases, container secrets or volumes ever enter the prepared image.
[[ -z $(docker ps -aq) && -z $(docker volume ls -q) ]] || exit 1
systemctl stop docker.socket docker.service
mkdir -p /opt/it-inventory-image
python3 - "$inputs/Image.Inputs.json" "$work" "$receipt" <<'PY'
import hashlib,json,pathlib,subprocess,sys
p=pathlib.Path(sys.argv[1]); m=json.loads(p.read_bytes()); w=pathlib.Path(sys.argv[2])
packages=subprocess.check_output(['dpkg-query','-W','-f=${Package}=${Version}\n']).decode().splitlines()
versions='\n'.join(sorted(packages))+'\n'
r={'schema':1,'recipeId':hashlib.sha256(p.read_bytes()).hexdigest().upper(),'scrubbed':True,
   'platform':m['platform'],'capabilities':['os-prerequisites','node-toolcache','npm-cache','playwright','supabase-images'],
   'nodeVersion':m['node']['version'],'npmVersion':m['npmVersion'],'playwrightVersion':m['playwright']['version'],
   'packageLockSha256':m['packageLockSha256'],'osPackagesSha256':hashlib.sha256(versions.encode()).hexdigest().upper(),
   'browsers':json.loads((w/'project/browser.json').read_bytes()),'images':[json.loads(f.read_bytes()) for f in sorted((w/'images').glob('*.json'))]}
data=(json.dumps(r,separators=(',',':'))+'\n').encode(); assert len(data)<=16384
pathlib.Path(sys.argv[3]).write_bytes(data)
PY
cd /
rm -rf -- "$work" "$inputs" /home/runner/.ssh /root/.ssh /root/.npm /root/.cache /root/.supabase /home/runner/.supabase
rm -f -- /home/runner/.npmrc /root/.npmrc /home/runner/.docker/config.json /root/.docker/config.json
rm -rf -- /home/runner/.npm/_logs /home/runner/.npm/_update-notifier-last-checked /var/log/cloud-init.log /var/log/cloud-init-output.log
find /home/runner /root -maxdepth 1 -type f \( -name '*history' -o -name '.node_repl_history' \) -delete
apt-get clean
rm -rf -- /var/lib/apt/lists/* /tmp/* /var/tmp/*
rm -f -- /etc/ssh/ssh_host_* /etc/machine-id /var/lib/dbus/machine-id
touch /etc/machine-id
cloud-init clean --logs --seed
chown -R runner:runner /home/runner/.npm /home/runner/.cache "$RUNNER_TOOL_CACHE"
chmod 755 /opt/it-inventory-image
chmod 644 "$receipt"
sync
cat "$receipt" >&3
# Host requires VM Off before hashing/publishing; this background helper emits no output.
nohup sh -c 'sleep 5; systemctl poweroff' >/dev/null 2>&1 3>&- &
