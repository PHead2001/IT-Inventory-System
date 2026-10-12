# Local GitHub Actions runner

The repository routes normal CI jobs to fixed self-hosted resource labels described below. Foundation CI keeps the stable `required` job: every PR and main fallback runs full application/database/browser validation on heavy; a main-only light evidence probe can select light `required` only for verified identical-tree PR validation, with a fresh fail-closed recheck. See [validation](../validation.md) for the evidence and trust contract. Production database delivery and the two trusted preview-access jobs remain light. The separate diagnostic `Local runner pilot` remains restricted to its exact reviewed SHA through the `it-inventory-pilot-<headSha>` label. Repository routing records the intended job labels; it does not activate or certify an installation. Activation state, installed bundle version, owner acceptance of the residual detection window, pilot/recovery receipts and normal-workload results are installation-specific evidence recorded with the PR. A successful one-job pilot and recovery check apply only to their recorded revision and installation; they do not certify the full Supabase/Playwright workload or authorize automatic activation. Record transient job IDs and host evidence with the PR; follow the security and workload gates below.

Pilot workflow runs share a concurrency group by PR number, while manual dispatches
use their ref. A newer event cancels an older run in that group, including a run
already executing, so stale SHA-specific pilot runs do not accumulate in the queue.
Only runs carrying this group supersede one another; runs already queued under
earlier workflow revisions without concurrency are not retroactively cancelled and
require separate deliberate cleanup.
This only coalesces workflow runs; it does not enable pilot pickup. The owner must
still intentionally activate the pilot for the exact reviewed SHA.

The design runs one repository-scoped, just-in-time GitHub runner in one fresh Ubuntu 24.04 Hyper-V VM at a time. A persistent Windows SYSTEM supervisor looks for queued jobs carrying one supported resource label, creates a disposable boot disk for one job, and deletes the VM and per-job files when the runner exits. The single boot-triggered supervisor first recovers the recorded old session under a lock, then begins pickup; recovery failure prevents pickup. A separate SYSTEM watchdog runs every minute and removes the recorded VM when its hard deadline expires or its supervisor/ready network guardian dies. Each VM explicitly disables automatic start and uses TurnOff at host shutdown; both settings are read back before boot. Restart always destroys the old VM before a new one can be launched. No host directory or cross-job package cache is mounted in the VM. The guest receives only its per-VM SSH public key and a one-job JIT configuration; the repository PAT stays on Windows.

## Unattended recovery and capacity status

Both SYSTEM tasks explicitly allow starting on battery power and keep running
when AC power disconnects. Their own CPU/RAM admission, hard session deadline,
network guard, cleanup and explicit Stop controls remain in force. Windows
critical-battery and sleep behavior is unchanged. Setup supplies these settings;
bundle update verifies both exact task identities before changing only the two
battery conditions on their existing settings, preserving other task settings.
An unexpected task action or principal blocks the update, and failed power-setting
readback leaves its journal pending and activation disabled.

After exact owned-session cleanup succeeds, the minute watchdog may restart an
exited **active** supervisor. It first acquires the supervisor lifetime mutex
without waiting, then the state mutex. A running supervisor or bundle updater
owns that lifetime mutex and prevents a second start. Recovery requires a secure
root, coherent protected installed manifest/receipt/dependencies, clear lifecycle
journals, valid active config, a protected well-formed machine-bound credential
record, no remaining recorded session or unexpected owned-prefix VM, and a
supervisor task in `Ready` state. It checks Stop/journals/config/session/task again
before requesting start. It never decrypts a token, changes activation, installs
an update, creates a VM or contacts GitHub. The fresh supervisor still performs
the full claim, host, memory and isolation checks before registration.

An explicit `Stop` remains suspended across watchdog ticks and reboot: recovery
never deletes `stop.requested`. Only the owner's Start/Restart control clears it.
Disabled activation, pilot activation (including a consumed pilot), disabled
tasks, invalid provenance/credentials/journals, unverified VM identity and failed
cleanup remain closed. Resolve unsafe state through the existing owner controls;
automatic recovery does not repair or adopt it. Routine API/guest startup errors
that leave no session retain the supervisor's 30-second retry. Low capacity is a
wait, not an error. Process exit is retried at the minute watchdog cadence only
after all recovery guards pass. A broken watchdog/task installation still requires
owner repair. Scheduled startup/recovery and offline tests do not establish real
reboot, process-loss or continuous 24/7 operation; record those host checks separately.

Queue inspection collects both `queued` and `in_progress` workflow-run snapshots
before inspecting jobs: a run already executing can have a queued continuation.
Each snapshot remains capped at 100 runs, with no pagination; overflow fails
closed before job lookup. Positive numeric run IDs are validated and deduplicated
across snapshots (at most 200 distinct runs). Runs are inspected oldest `created_at`
first using the UTC instant, then numeric run ID for ties. A duplicate uses its
oldest valid observed timestamp. Missing or invalid timestamps remain eligible
after all dated runs, ordered by numeric ID; this compatibility policy does not
invent an age from provider response order. Each job view remains capped at 100.
Unsupported labels, nonfitting capacity and mismatched session profiles are still
skipped, and exact pilot workflow/SHA/job binding and Stop checks remain required.
This orders provisioning demand; GitHub assigns the actual job to a compatible
JIT runner, so selecting a run does not force that runner to take its job. It
adds no special main/production routing or authorization bypass.

Status reports current available physical memory and guest/reserve/admission for
every applicable fixed profile, so an idle controller does not imply capacity for
a queued heavy job. The bounded queue traversal records only observed per-profile
counts, capacity and the last controller poll outcome/timestamp in protected
`controller-observation.json`. Traversal may stop at the first fitting job; counts
describe inspected demand, not a complete queue census. Unsupported requests are
not counted as eligible demand. Status distinguishes this historical poll from
current capacity. A stale poll during blocking one-job execution is not proof of
process loss and never triggers cleanup. No token, JIT value, API payload, job ID
or guest output is recorded. Corrupt/missing observations do not authorize work.
For a recorded VM, Status reads its startup memory/dynamic flag only after matching
the recorded name, ownership tag and exact nested configuration path; a mismatch
or unavailable readback is reported explicitly. Capture this while the guest exists,
before normal ephemeral cleanup, to establish actual candidate allocation.

## Owner setup

### Prepared guest image

After installing the reviewed bundle, choose **Prepare trusted image while idle**
in Setup once. This owner action builds a credential-free guest from the pinned
generic Ubuntu base. It waits for the idle supervisor to acknowledge pickup
suspension and refuses an existing session; it never stops a running job. The
builder uses the fixed heavy memory/CPU profile, the existing network isolation,
guardian, readiness checks, hard deadline and owned cleanup. It never decrypts
the GitHub credential, downloads/registers a runner, receives a JIT value, checks
out a PR or executes a job. Successful preparation resumes previously active
pickup when no explicit Stop marker existed. Previously stopped or inactive
pickup stays suspended; failed preparation stays suspended for investigation.

The sealed builder disk is copied as bytes into a newly created candidate under
the protected image directory. The candidate inherits that directory's ACL;
the source disk's Hyper-V access entries are not copied. The destination ACL is
checked before any bytes and again after copying. A held source read handle
denies writes/deletion, and bounded copy buffers retain the session deadline and
guardian/sealed-state checks without holding the state mutex during bulk I/O.
Existing candidate paths are never overwritten. Unexpected ACLs on retained
artifacts still stop preparation and require a separately reviewed owner repair.

The trusted installed bundle contains five builder inputs: `Image.Prepare.sh`,
`Image.Inputs.json`, `Image.Package.json`, `Image.PackageLock.json` and
`Image.Supabase.toml`. The fixed recipe installs OS/Docker prerequisites, the
pinned Node/npm toolchain, npm download cache, Playwright headless browser/system
dependencies and the enabled Supabase service/test images. It pulls images without
starting Supabase or creating database containers/volumes. The builder scrubs its
temporary checkout, input files, SSH keys, credentials/config/history and cloud-init
identity before emitting a bounded receipt and shutting down gracefully. It uses
[cloud-init's documented clean options](https://docs.cloud-init.io/en/latest/reference/cli.html)
to remove generated network configuration and reset the machine ID, then requires
the builder's `50-cloud-init.yaml` to be absent and the systemd machine ID to be
`uninitialized`. The fresh-clone gate verifies the resulting boot behavior. No job
disk is ever retained as an image.

Storage is pulled once from an available official mirror. The builder adds the
four exact-version runtime mirror aliases to that verified local image ID, checks
each alias resolves to the same ID, and records this proof in the bounded receipt.
Alias creation does not pull more images. The host verifies the exact alias set
against the installed trusted manifest before accepting scrub/publication proof.

The host requires successful scrub proof, the exact recorded VM identity in
`Off` state, verified VM removal, and an offline disk with no registered VM
references. It copies that disk to a new protected, unselected candidate and
hashes it. While pickup remains suspended under the same owner control, a second
credential-free `verify-image` session boots a differencing child through the
prepared path, with a fresh MAC, SSH key and NoCloud instance. Two successive
children use the same retained, verified read-only parent handle. Each checks a
fixed marker is absent, writes it only into its own guest disk, and verifies that
write. Both must have distinct VM/MAC/key identities and verified cleanup; the
second child must not see the first child's marker. Each verifier must
pass the canonical cloud-init and runner prerequisites (including Docker for its
fixed heavy profile), network isolation and live guardian checks. Its VM removal
and unreferenced instance cleanup must then complete successfully. The original
candidate is never booted: its hash is checked before verification and again
after both verifier cleanups, before publishing `prepared-image.json` last. Receipts
bind the complete installed bundle, five inputs, generic base hash, scrub proof,
actual Docker image digests, browser/OS provenance, and the fresh verifier's
identity, readiness and cleanup proof. Failed/interrupted builds or verification
cannot replace the selected image. Retention keeps the selected image and one
prior image, deleting only recognized protected unreferenced candidates.

Each job still receives a **fresh disposable boot disk**, a new MAC/SSH key/NoCloud
instance ID and its ordinary memory profile. Prepared copies omit apt installation
only after all protection/provenance/content checks pass. Their cloud-config also
omits creation of the existing Docker group while retaining the runner's sudo and
Docker memberships. A captured failed verifier confirmed that redeclaring this
group produced cloud-init's existing-group warning and exit 2, which correctly
failed strict readiness even though all initialization stages completed. Generic
guests still declare the group before installing packages. Node uses a guest-local
`/opt/hostedtoolcache` with setup-node completed markers; npm and browser caches
live in the guest's normal runner home. New PR pins download cache misses inside
that one disposable guest. A job cannot write caches or disks back to the host;
its entire disk is deleted after execution. The separate verified runner archive
cache keeps its existing metadata/hash checks.

Prepared job disks use Hyper-V differencing only when the current installed
binding's clone receipt explicitly proves both isolated children, their matching
parent file identity, restrictive lease and marker probes. Earlier clone proof
authorizes the existing full-copy path only. Generic fallback and the image
builder always use standalone full copies. A stale selected prepared image is
still content-verified before generic fallback; corruption never becomes a miss.
The new prepared clone gate must pass on the real host before accepting optimized
pickup. If Hyper-V cannot create or boot the child while the restrictive parent
handle remains open, preparation fails closed; no automatic sharing relaxation
or alternative clone strategy is installed.

The supervisor verifies image content through a noninheritable read-only file
handle opened with `FileShare.Read`. It hashes that same handle once, then retains
it across job child creation, execution and cleanup. Warm reuse requires the same
live process owner, Windows volume/file identity, expected digest and complete
selector/receipt/recipe/bundle binding. Every claim rechecks protected paths,
ACLs and metadata. Length and timestamps never authorize reuse. Restart, binding
or selector change invalidates verification; owner image replacement drains
leases only while idle. Failed cleanup retains state/artifacts and live-owner
leases and refuses another claim. Process death closes OS handles; protected
parent storage, guardian/recovery and fresh verification on restart remain the
boundary. This is no persistent verified flag or promise of protection after
process death.

Prepared-image protection has one narrow native Hyper-V exception. Only
`prepared-images/<32 lowercase hex>.vhdx` files under the fixed protected runner
root may carry explicit, noninherited, nonpropagating Allow entries for
`S-1-5-83-0` and
`S-1-15-3-1024-2268835264-3721307629-241982045-173645152-1490879176-104643441-2915960892-1612460704`.
Their positive rights must be a subset of `Read | Synchronize` (1179785).
The owner must remain SYSTEM or Administrators and the parent directory must
retain the ordinary strict protection. Other readers, inherited native entries,
write/delete/ACL/ownership rights and reparse points fail closed. This exception
is rechecked for candidate verification, publication, each lease/child and
retention; generic base images, tools, configuration, receipts and credentials
retain SYSTEM/Administrators-only access. Candidate import still creates a new
file with its protected directory's descriptor and copies only source bytes.
Native host probes observed those two read entries appearing on a parent when
`Add-VMHardDiskDrive` attached its child; copying and `New-VHD` alone did not add
them. Descriptor fixtures cover this policy without mutating host ACLs; live
successive-child boot/scrub/publication evidence is still required.

Image preflight uses a ten-minute deadline and 4 MiB hashing chunks with Stop and
deadline checks between reads, outside the guardian mutex. Protected
`preflight-observation.json` records only fixed phases, process identity, start,
deadline, progress bytes and observation time; Status labels this historical
evidence. Synchronous filesystem/provider I/O is not forcibly preempted, so these
checks do not prove a hard timeout for a hung OS call. Fresh queued-profile demand
is checked before image work, before disk creation/copy and before boot, while
the existing post-recovery pre-JIT demand check remains authoritative. Oldest
workflow continuations, capacity admission and provisioning cancellation policy
are unchanged.

Reference checks follow registered VM disks and retained managed child disks
through at most 32 ancestors, rejecting cycles, unknown parents/types and bounded
inventory overflow. A parent or instance referenced indirectly is retained.
No parent is merged, resized, compacted or attached directly by this job path.
The owner preparation receipt records each child's preflight, creation, readiness
and session durations. Offline tests prove control flow and real Windows file
sharing, not Hyper-V compatibility or queue-to-registration speed. Acceptance
still requires real successive-child isolation/cleanup, unchanged parent hash,
and measured cold/warm light and heavy startup without skipped workload gates.

Candidate copy and full hashes run outside the state lock, allowing the guardian
to cancel the builder during this work. Staging requires a fresh builder
session/GUID, committed scrub proof, unchanged trusted binding and
offline/unreferenced source and candidate. Publication follows successful
verifier cleanup and briefly reacquires the state lock to confirm idle ownership,
unchanged binding/selector and an offline, unreferenced candidate. Failed
verification keeps Stop in place and removes only its unselected candidate;
uncertain VM removal retains the canonical VM/state for investigation. Interrupted
unselected files are purged by the next explicit preparation after reference
checks. There is no resumable verification or publication action.

Absent prepared images or changed trusted inputs use the generic base, with an
explicit reason. Generic guests use the runner's default writable tool-cache path.
Corrupt hashes, unexpected ACLs and reparse points fail closed. Status compares
built and installed recipe identities and reports fallback; it checks metadata
only to stay fast. Full disk hashing and offline/reference checks occur before
job pickup. An image remains installation-specific evidence: offline tests do not
prove live guest boot, scrub, graceful shutdown, cache hits or workload timing.

To refresh trusted pins reproducibly, review the recipe and repository pins, then
run `Write-Bundle.ps1 -Version <strictly newer version>` in the source checkout.
That helper runs `node scripts/runner-image-inputs.mjs`, using the already installed
pinned Playwright package to create deterministic snapshots without downloads.
`node scripts/runner-image-inputs.mjs --check` detects stale source snapshots.
Install the new bundle through Setup, then explicitly prepare its image. PR changes
never trigger host image preparation or host writeback.

Double-click `scripts/local-runner/Setup.cmd` and accept the Windows elevation prompt. Its small menu offers **Enable Hyper-V**, **Install or resume**, and **Store GitHub token**. Enabling the feature never restarts Windows automatically; restart if Windows requests it, then open Setup again and choose Install. A failed step stays visible and can be retried from the menu. The defaults target `PHead2001/IT-Inventory-System` and GitHub's default runner group ID `1`; the JIT API will reject an invalid group rather than silently choose another repository. Setup stops if another Windows NAT occupies the host, including one used by Rancher/WSL. It never removes or changes that NAT, the Rancher distribution, or an existing VM.

Setup downloads two fixed official Ubuntu artifacts with pinned SHA-256 values: the generic [Noble cloud QCOW2 image](https://cloud-images.ubuntu.com/releases/noble/release-20260926/) and [Ubuntu 24.04.5 WSL image](https://releases.ubuntu.com/24.04/). A dedicated WSL image converter installs `qemu-utils` and converts the verified QCOW2 into a Hyper-V VHDX. WSL retains Windows host integration and is a trusted setup tool, not an isolated job sandbox. Its random distribution name is recorded in the protected setup stage before import; resume requires the same Windows WSL registration and owned base path. An unrecognized or preexisting converter is refused. Conversion writes a temporary VHDX, validates and resizes it, then records the completed output hash. Resume verifies both the source and output hashes; a partial or unreceipted VHDX is regenerated. Before setup completes or the token menu can run, setup verifies the exact owned converter registration, terminates it, verifies ownership again, unregisters it, and verifies its absence. Retirement failure keeps setup incomplete; retry uses the protected stage. The Azure VHD is intentionally excluded: [Canonical says it will not work on local Hyper-V](https://ubuntu.com/docs/public-images/public-images-reference/artifacts/). Canonical documents [generic image conversion and NoCloud on Hyper-V](https://ubuntu.com/blog/how-to-use-ubuntu-on-windows). Generic fallback copies the converted VHDX; only a separately verified prepared image can serve as a read-only differencing parent.

Setup creates `C:\ProgramData\ITInventoryLocalRunner`, a temporary image-converter WSL distribution, a dedicated internal switch/NAT on `172.30.240.0/29`, and two SYSTEM tasks. It protects the fixed data root with a non-inheriting SYSTEM/Administrators-only ACL and refuses an unexpected owner, reparse point, conflicting switch/NAT, or overlapping host address. Partial setup can be rerun for the same repository/group using its tagged setup stage; it never adopts a reserved switch/NAT that existed before its own stage. It leaves job pickup disabled. VM creation journals a provisional identity before New-VM; recovery accepts an untagged VM only while Off, with the exact recorded GUID name, exact nested configuration path (`instances\<vmName>\<vmName>`, since New-VM appends its name to the supplied path), and exactly the recorded boot disk. Tagged recovery also requires this exact configuration path. Tag readback advances that journal before any additional attachment or boot.

WSL may record the converter's registry BasePath as `\\?\C:\ProgramData\ITInventoryLocalRunner\image-converter`. Setup compares that extended DOS spelling with the same ordinary local path after narrow normalization, while still requiring the exact recorded distribution name, owned root and absence of reparse points. UNC/device paths, ambiguous extended components and genuinely different paths remain rejected. If import completed before an ownership error, retry **Install or resume** with the corrected scripts; retain the protected setup stage and registered converter rather than deleting or adopting another distribution.

Linux conversion commands use WSL `--exec` and preserve each native argument, including Windows path backslashes and spaces. Path translation checks the process exit code and requires one nonempty absolute Linux path before conversion; failure stops with a specific translation error instead of trimming missing output. If an earlier attempt showed `wslpath: C:ProgramData...` followed by a null-expression error, retry **Install or resume** with the corrected scripts. Verified downloaded images and the recorded converter are reused.

WSL also requires its option prefix to remain unquoted; the native encoder quotes only empty or complex argument values. Setup first probes the exact converter's installed `qemu-img` and skips apt when it is already working. Fixed setup-command failures show their exit code and bounded, control-cleaned diagnostic output. If further evidence is needed, exit an already open Setup menu, reopen `Setup.cmd`, and choose **Diagnose recorded converter**. This option verifies the protected stage and exact owned registration, then runs only fixed version, command-availability and path-translation probes, each with a 30-second timeout. It does not install tools or unregister anything. Reading the protected converter from a non-elevated shell may report WSL `E_ACCESSDENIED`; keep the ACL intact and use the elevated menu for that diagnostic.

Create a **fine-grained GitHub PAT limited to this one repository**, with repository **Administration: read/write** for JIT runner registration and **Actions: read** for queued-job inspection. Choose **Store GitHub token** in the Setup menu and paste the token only into that local secure prompt. The credential is encrypted with Windows DPAPI LocalMachine, stored under the SYSTEM/Administrators-only root, and never written to the guest or workflow. Local administrators are part of the trusted host boundary. Do not paste the token into chat, command arguments, `.env`, the repository, or a screenshot.

After the code and host network policy are independently reviewed, the pilot operator chooses **Enable one-job pilot and start** in Setup and supplies the full reviewed head SHA. The pilot workflow uses `it-inventory-pilot-<headSha>`; its JIT runner advertises only that SHA label and the explicit `self-hosted`, `Linux`, and `X64` labels, so jobs requiring an active resource or legacy generic label cannot take the pilot runner. Labels route jobs; they do not authorize hostile workflows. Jobs requesting only default labels, or copying the pilot label, remain eligible. The owner must inspect the committed workflows and queued jobs before enabling the pilot. The JIT response must contain exactly the requested labels. The supervisor commits the initial session state and exact pilot receipt under one state lock, with state first; it creates no instance directory, VM or JIT runner until both writes succeed. The state retains the exact receipt bytes. A crash between writes conservatively consumes that claimed pilot: recovery, Stop and watchdog cleanup must complete or verify the receipt before removing the state. A changed receipt or invalid claim blocks cleanup and further pickup, so interruption cannot launch a second pilot job. Queue selection and fresh checks before consumption and JIT registration bind the fixed `.github/workflows/local-runner-pilot.yml` path, workflow ID, run ID/attempt, head SHA, label and job ID. Success and active activation re-fetch that GitHub metadata and require the selected job completed on the exact JIT runner name and ID; another runner's success or a still-running job cannot enable active pickup. A failed or uncertain pilot remains consumed and requires maintainer investigation. After diagnosis and review, **Maintainer retry** requires a new reviewed SHA and a nonsecret reason, a stopped supervisor, and no session/owned-prefix VM. It first records a pending `pilot-retry.json` with the exact old evidence hashes, target config, SHA/reason and archive identity. It verifies the full archive in protected `pilot-history`, disables pickup, removes only matching old receipts, binds the new pilot, then atomically marks the journal complete; it does not start pickup. An interruption is resumed only by **Maintainer retry/resume** with the identical recorded SHA and reason. Unexpected config, receipt or archive changes reject resume. Pending retry journals block pickup and activation; completed journals and prior evidence are retained permanently, and absent current receipts cannot become a new initial pilot. The direct control is `Runner.ps1 -Action RetryPilot -ExpectedPilotSha <newSha> -RetryReason <reason>`. Initial direct activation likewise requires `-Action EnablePilot -ExpectedPilotSha <sha>`. Setup's **Status** option reports the activation state, consumed job, recorded proof, and fixed failure stage/code; exception messages and credentials are omitted. **Enable active pickup and start** requires the successful recorded pilot. Before using that option, the owner must additionally accept live guest isolation, synthetic network-drift termination, cleanup, and the residual detection window described below. Existing production environment branch restrictions remain main-only, and no workflow routing or environment settings are changed by these scripts.

Setup adds a **IT Inventory Runner** folder on the Windows Desktop with **Start**, **Restart**, **Stop**, and **Status** shortcuts. They show an elevation prompt and open a visible control window. The underlying `.cmd` controls also live in `C:\ProgramData\ITInventoryLocalRunner\bin`. Start keeps the SYSTEM supervisor running across sign-out and Windows restart; Status reports activation and the one recorded VM. Stop halts the supervisor and removes its VM. Restart stops and deletes the current VM before starting the supervisor again.

After pulling reviewed runner changes, open the repository's `scripts/local-runner/Setup.cmd` and choose option 2 to update the installed bundle. `Bundle.json` versions and hashes every runtime/control dependency; credential and activation controls refuse a different or incomplete installed bundle. An exact installed bundle is an idempotent no-op. A changed bundle must have a strictly higher date and numeric revision (`.10` follows `.9`); older versions and equal versions with different contents refuse before suspension or replacement. The installed manifest, receipt and dependencies must be coherent. Only an installation predating both manifest and receipt uses the legacy upgrade window.

`Update.ps1` checks for an idle session and publishes the protected `stop.requested` marker together under the state lock, then waits up to 35 seconds for idle pickup to exit gracefully. Session-state/pilot-receipt publication uses that same lock: either suspension wins and no pilot is consumed, or the complete claim wins and update refuses. It never invokes destructive Stop, including during resume. Any session/VM that appears, timeout, or unexpected removal of the marker causes refusal without deleting the session or its evidence. Windows management calls and lock acquisition may take additional time. The updater then obtains the supervisor lifetime lock followed by the state lock, rechecks idle state, the marker and version, journals the old config and installed hashes, and retains protected staged files for recovery. It disables activation before any script replacement, verifies every final file and the installed bundle receipt, restores the exact old config, then marks the update complete. Config, credentials, images, task definitions and pilot evidence are preserved, and pickup stays stopped. A pending update is explicitly resumed through option 2 or `Update.ps1 -Resume` using its exact retained staged bundle; later checkout changes cannot silently alter that plan, and partial installed versions do not prevent recovery. New controls refuse pending lifecycle journals. Legacy controls may run the original coherent bundle if an interruption occurs before activation is disabled; no partially replaced bundle is allowed to run. A raced legacy claim causes update refusal. New supervisors recheck suspension and lifecycle journals before pilot consumption and session creation.

Owner controls share a dedicated fail-fast control mutex across Update/resume, Start, Restart, Stop, pilot activation/retry, active activation and credential storage. A concurrent command refuses immediately; it cannot wait and run after the first command completes. Internal Restart reuses its command ownership. The lock order is control, supervisor lifetime when needed, then state; the background supervisor, guardian and watchdog never take the control mutex. Start uses the state lock without taking the persistent supervisor lifetime lock. **Before the first installation of this protocol, close every older Setup/control window and stop the supervisor through the owner controls, then keep controls quiescent until the update completes.** Already loaded older scripts cannot participate in a newly added mutex. New source and installed controls participate after installation.

Named locks use an explicit protected DACL granting full control only to SYSTEM and built-in Administrators, with a trusted SYSTEM or Administrators owner. Each returned object is validated before waiting. Migration also accepts an existing SYSTEM-owned lock with only SYSTEM full control, or the captured Task Scheduler descriptor on the four exact runner mutex names: three explicit allow entries for Owner Rights read-control only, SYSTEM full control, and the exact `NT SERVICE\Schedule` service SID full control. Other service identities, extra rights/grants, inherited entries or deny entries refuse this legacy exception. Legacy ACLs are never changed in place. An elevated administrator cannot open the historical lifetime lock, so migration must run the canonical idle suspension/update under SYSTEM and let the old supervisor release its lock gracefully. It must not kill a job or replace the existing lock. Offline checks prove descriptor policy and retain real process contention/abandonment through an unbundled GUID-only ordinary-user test factory. Administrator/SYSTEM kernel access requires a separately reviewed elevated migration smoke test before installation.

Initial setup retains a protected `setup-publication.json` before publishing its final scripts, manifest, installed receipt or config. Its intent includes the exact owned setup-stage evidence, disabled config and bundle bytes/hashes/receipt. Config is published last, after the verified bundle and receipt. Option 2 detects pending publication before choosing the updater, even when config already exists, and resumes that exact intent without adopting a later checkout. Only absent or byte-for-byte expected artifacts are accepted; tampered files/config/receipt or changed setup-stage evidence refuse recovery. Completion is recorded before the owned setup stage is removed. A completed publication cannot recreate arbitrarily missing installed artifacts. Preserve both protected records after an interruption and use option 2; do not delete the receipt or substitute another checkout's files.

If a retry was interrupted before pulling a newer checkout, choose **Maintainer retry/resume** first. Option 9 verifies the installed bundle against its own protected manifest and receipt, then uses the exact recorded SHA/reason without requiring the newer checkout to match. Tampered or incomplete installed bundles and pending updates refuse recovery; fresh retries still require checkout equality. Complete retry recovery before explicitly installing the newer bundle.

For script maintenance, regenerate the manifest with `powershell.exe -NoProfile -File scripts/local-runner/Write-Bundle.ps1 -Version YYYY-MM-DD.N`, format `Bundle.json`, and review it with the changed scripts before installation. All 21 packaged text dependencies must use LF line endings so their byte hashes survive Git checkout; the authoring helper refuses carriage returns before snapshot generation and again before hashing, and the contract gate checks this before native suites. This authoring helper only writes the checkout manifest; no runtime downloads or automatic updates are performed.

The network-recovery bundle includes `Network.Recovery.ps1`, its fixed `Network.Recovery.Probe.ps1` worker and `Probe.Job.ps1`. Only the reviewed pre-recovery eighteen-file versions `2026-10-06.7` and `2026-10-06.8` remain verifiable at the protected installed path so the normal idle updater can migrate them; new source still requires the complete current dependency set. Other eighteen-file versions are refused. The separate older twelve-file compatibility contract remains unchanged. This exception does not rewrite installed image receipts. Prepared images bind the whole installed bundle as well as recipe/base inputs. A host-script update therefore makes an existing image binding stale and uses the canonical cold-base fallback; cold cloud-init/download work can be slower. A new prepared image requires the existing explicit owner-controlled build/verification/publication flow. This repair neither relabels old images nor automatically rebuilds one.

Idle pickup retains its 30-second poll budget in one-second Stop-aware waits. It checks suspension after reconciliation and memory/queue work, and before/after each read-only queue API request, including pilot demand metadata. A marker observed during read-only inspection ends that poll without consuming a pilot, allocating a VM or registering a JIT. Existing state-locked claim and update admission still decide session/VM races. This does not cancel an already dispatched registration POST, discard its ambiguous response journal, or interrupt authoritative post-job pilot verification. The 35-second update acknowledgement is therefore a bounded wait, not a universal exit guarantee while durable post-job or synchronous provider work remains in flight. A timeout retains the requested suspension marker and refuses installation; it never force-kills the supervisor or automatically retries. Any later continuation requires the exact failed-attempt evidence plus fresh coherent stopped-task, protected marker, unchanged configuration/image and clear-journal proof; historical absence alone is insufficient.

## Resource profiles and cutover

Cleanup verifies a complete Hyper-V inventory against an independent `Msvm_ComputerSystem` provider inventory before treating a VM as absent. A failed/partial query or GUID/name disagreement blocks cleanup, admission, unattended recovery and updates. VM creation journals its GUID immediately after `New-VM`; cleanup binds that GUID when present and retains the existing name/tag/path ownership checks. Legacy state without a GUID also requires that no remaining registered VM references a configuration path or disk at or under its instance directory. Stop/removal errors, surviving registrations and unverifiable post-removal absence preserve instance files and state. Status reports an unverified inventory without exposing provider exception details.

These checks prevent cleanup from deleting files after an uncertain lookup; they do not repair or adopt an unknown or damaged VM registration. An orphan with no trustworthy state requires separate owner-authorized investigation and a targeted recovery plan. Preserve disks, configuration and registration evidence; never bulk-delete Hyper-V caches or recreate state from a matching display name. `Cleanup.Integrity.Tests.ps1`, included in the canonical contract command, exercises these refusal and verified-absence paths with mocked VM/provider operations and disposable TEMP files. Source tests do not prove that the updated bundle is installed or that real host recovery succeeded.

Install the reviewed updated runtime bundle **before pushing workflows that request
these new labels**. The owner controls the subsequent merge of workflow changes to
main; a branch runtime update does not change trusted main workflows. The installed
bundle and exact-SHA job evidence must establish that cutover separately.

| Custom label                   | Guest memory | Required available host memory | Normal jobs                                         |
| ------------------------------ | ------------ | ------------------------------ | --------------------------------------------------- |
| `it-inventory-light`           | 2 GiB        | 4 GiB                          | Preview discover/provision, production database     |
| `it-inventory-mid`             | 4 GiB        | 6 GiB                          | Available for reviewed workloads                    |
| `it-inventory-heavy`           | 6 GiB        | 7 GiB                          | Required application/database/Playwright validation |
| `it-inventory-ephemeral`       | 8 GiB        | 10 GiB                         | Legacy workflows                                    |
| `it-inventory-pilot-<headSha>` | 8 GiB        | 10 GiB                         | Exact-SHA diagnostic pilot                          |

The mapping and host reserve are fixed in host code. Heavy uses a 6 GiB static guest
plus 1 GiB unallocated host reserve; light/mid retain their existing 2 GiB reserve.
Legacy ephemeral and exact-SHA pilot retain 8 GiB guests plus 2 GiB reserves to
preserve their earlier contracts and diagnostic evidence. The explicit heavy
candidate addresses admission starvation on a busy 32 GiB development host; it is
not accepted as viable until a complete real database/Playwright workload passes
with no checks skipped. Preserve exact job SHA, installed bundle hash/version and
verified 6 GiB/static-memory readback. A job pass proves workload viability for that
run, not measured absence of memory pressure/OOM or indefinite availability.
Admission is not a reservation and does not guarantee sufficient memory for every
future workload. Workflow/config values cannot set arbitrary guest memory or
reserve. Each JIT advertises `self-hosted`,
`Linux`, `X64` and exactly its selected custom profile label. A heavy guest cannot
be diverted to a normal light or mid job while the database job waits. Legacy and exact-SHA pilot
sessions each retain their single custom label; normal guests never advertise the
legacy label. Unsupported or mixed resource/platform requests are ineligible for
provisioning. This request filter is not an assignment security boundary: a job
requiring only default labels or a subset of advertised labels can still be assigned.
Labels route jobs and do not authorize hostile code. Active selection
chooses a profile, not an exclusive GitHub job claim: GitHub may assign another job
requesting that profile to the one-job runner. Immediately before JIT registration,
a fresh bounded queue traversal checks for demand requesting exactly the selected
profile, skipping other profiles. It does not recheck host free memory after
allocation. If demand was canceled or taken and no exact-profile job remains, the
session returns `demand-withdrawn` and performs normal owned cleanup without creating
an idle JIT runner. API uncertainty or queue overflow fails closed with cleanup.
The pilot retains its exact binding and fresh exact-job registration check.

Generic fallback guests remain full disposable copies of the unchanged, verified Ubuntu base; prepared job guests use independently verified disposable differencing children.
Cloud-init installs common TLS/download, Git, SSH and unzip prerequisites for every
profile. Light and mid omit Docker installation and its readiness probe: required
aggregation uses Bash, preview discovery/provisioning use Node, production delivery
uses the linked remote Supabase CLI, and application validation uses Node/npm without
starting local Supabase. Heavy database/browser, legacy and diagnostic pilot guests
retain Docker installation and Docker daemon readiness. New workflows needing Docker
must request heavy or revise this reviewed prerequisite contract. Package updates
still run in each guest; heavy startup still incurs package and Docker installation.

The host fetches the latest official GitHub runner release metadata on every archive
request, including cache hits, and requires its SHA-256 digest plus matching release
tag, asset name and official download URL. Verified archives live in the protected
`runner-cache` directory, keyed by digest. Owned-path, reparse-point and protected ACL
checks apply before reuse or cleanup; corrupted or unexpected entries refuse pickup
without silent replacement. A dedicated mutex serializes publication and retention.
Downloads use temporary files and publish with a same-directory rename only after
hash verification. Recognized interrupted download files are removed on the next
request; retention keeps the current archive and at most one verified previous
archive, with a bounded 16-entry inspection limit. Metadata failures never use a
stale fallback. Guests receive an SCP copy, never a cache mount or write access.
Only official runner bytes are shared; repository dependencies and guest state remain
disposable. Guest readiness and archive retrieval/transfer/extraction report elapsed
seconds without guest output or credentials.

After a one-job runner exits normally and owned cleanup succeeds, the supervisor
immediately reinspects demand. Idle queues, withdrawn startup demand, low memory
and failures retain the 30-second backoff. This removes the per-completed-job pause
without retrying failed bootstrap or cleanup in a tight loop.

Demand can still disappear after the final check, leaving a JIT runner waiting.
An idle light runner cannot accept a later heavy job. Its hard deadline still
bounds that wait; an earlier operator Restart requires fresh evidence that the
exact owned runner is idle and no job is using it. Never terminate a guest merely
because the host heartbeat is old: the blocking one-job wait does not refresh it.

Active pickup checks Windows available physical memory against the light minimum
before its bounded queue traversal, skips nonfitting larger jobs, and rechecks the
selected profile before any claim/VM allocation. Pilot pickup retains its 10 GiB
minimum. Low capacity waits on the existing 30-second loop without consuming a
pilot or allocating a VM. Invalid/failed inspection refuses work. Selection flows
through session state, fixed VM startup memory/readback and exact JIT label readback.
Older sessions without profile fields remain recoverable. Status reports a bounded
minimum-capacity advisory. Admission is not a reservation; a later allocation race
still fails closed at `vm-boot` and uses the existing cleanup path. Real workloads
and independent security review remain required before installation/acceptance.

## Boundaries and required proof

The host-side Hyper-V extended port ACL denies IPv6, private/link-local/CGNAT destinations, current host addresses and all non-default IPv4 routes, including routes through corporate/VPN gateways, and all unlisted traffic. Split-default VPN routes (`0.0.0.0/1` and `128.0.0.0/1`) intentionally block Internet readiness and fail closed. It allows public HTTP/HTTPS, public TCP 5432 for the linked Supabase session endpoint, and public DNS, plus host-to-guest SSH for setup. The pinned Supabase CLI uses pooler session port 5432; port 6543 is not opened. A linked database workflow requires a public IPv4 session endpoint; these checks do not connect to production or prove actual production connectivity. Higher-priority private/host/route denies also apply to port 5432. Each rule has a distinct weight: public TCP 100-102, DNS 110-113, inbound SSH 150, then ascending private, route, host and IPv6 denies from 200; default denies use 1 and 2. Host addresses and route prefixes are sorted and deduplicated. Invalid inspection data or more than 4096 total deny rules aborts before ACL modification. The count includes both default denies; the eight allow rules do not consume this deny limit. Rules are installed and read back before VM boot and checked again before JIT registration. A live guest-to-host TCP denial and public GitHub TLS/DNS probe must pass before registration. These controls are host-side; a guest firewall rule cannot replace them. [Microsoft documents rule weights and stateful return traffic](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/create-security-policies-extended-port-access-control-lists).

Before constructing the NoCloud seed, the host assigns a collision-checked random locally administered static MAC to the owned, never-booted guest adapter. The assigned address is journaled and read back before/after boot and before JIT registration; the seed matches that exact address. Hyper-V may report an all-zero dynamic MAC before first boot, which cannot be used as the guest match. Generic cloud-init declares the Docker group before creating the `runner` user and installing Docker; prepared seeds retain membership without recreating the group. Guest readiness requires successful cloud-init completion (exit 0) and `docker info` as the unprivileged `runner` user; a Docker socket alone is insufficient. Cloud-init warnings or Docker access failures keep readiness pending instead of registering a runner.

After a consumed pilot fails, preserve `pilot-attempt.json` and the recorded failure; do not clear the receipt or restart pickup blindly. The owner can run `DiagnoseNetwork.ps1` elevated for read-only host routes, ACL capability and owned-network evidence. After independent review and explicit owner authorization, `ProbeNetworkAcl.ps1` can reproduce the current policy on one fresh, diskless VM that is never booted. It reports the exact failing rule or readback error and removes only its verified VM ID/name/Off state/path/tag/diskless identity and owned folder. Inspect its JSON `cleanupVerified` and `cleanupError` fields; a successful shell exit alone is insufficient. Its two-minute limit applies between ACL commands, not to the duration of an individual Windows management call. Coordinate concurrent WSL/Docker network work so it does not change the network during the diagnosis.

A separate per-session Windows guardian starts and confirms readiness before VM boot. Its protected recovery journal retains the exact VM GUID, adapter ID, Internal switch GUID, static MAC, claim and process identities. It observes host IPv4/IPv6 addresses and routes, including destination, next hop and interface, between one-second loop waits. On drift or failed inspection, it pauses its running VM, disconnects the owned adapter and verifies isolation before changing ACLs. An Off VM stays Off. Fingerprint and policy consume one retained capture bracketed by matching complete captures; three spaced matching observations precede policy installation and three more precede reconnect. After slow identity/ACL preflight, a new observation outside the state lock precedes serialized Connect/Resume admission, which rechecks deadlines, generation, Stop and observation age. The supervisor waits for this guardian rather than repairing independently or reusing startup ACL arrays. Flaps keep the original 120-second outage episode and unchanged hard deadline. Uncertain provider results, ownership changes, Stop, dead owners or expired guardian progress use canonical cleanup; refusal retains protected state/files.

During explicit owner image preparation, the root Stop marker suspends pickup while the builder and verifier run. Only a freshly read protected state passing the existing identity, purpose and candidate checks can retain that preparation exemption. An instance cancellation always wins; job sessions and missing purposes still honor root Stop. Owner Stop still removes the exact recorded instance, and removed or replaced state cannot authorize a later provider operation. Creation still requires the existing owner preparation authorization.

The watchdog checks every recorded guardian process identity even when guardian readiness is false during quarantine or recovery. A dead guardian or an incomplete recorded identity requests canonical cleanup immediately on the watchdog check, independently of the supervisor returning from a native command and before the recovery progress/outage deadline expires. Initialization retains grace only while no guardian identity is recorded. Readiness continues to gate guest boot and JIT admission; it is not a process-liveness exemption.

Failed liveness and cleanup decisions retain a bounded, nonsecret observation of the checks already evaluated. An exception's `runnerFailureObservation` contains only fixed reason/phase enums, Boolean checks, UTC time and numeric deadline/progress values. The protected `failure-cleanup.json` keeps the first decision and the latest secondary observation for a validated session/owner-start identity within 4096 UTF-8 bytes. Schema 3 permits an unrecorded VM ID only when the state has no GUID property and its phase is initial (phase not recorded) or creating; this is not proof that no VM exists. Owned/sealed-off state requires a nonempty valid GUID. Schema 2 remains readable; the next valid write uses schema 3. Unrecorded-to-known promotion for the same session/owner preserves the first observation. A known GUID cannot be downgraded, and a different known GUID or owner rotates the record. It contains no credentials, raw state, exception messages, command arguments or paths. Unavailable capture is explicit and cannot prevent canonical cleanup. Malformed historical evidence remains retained rather than being silently replaced. Diagnostic evidence never authorizes cleanup. Reviewed preparation helpers capture this evidence before updating and after the attempt, distinguishing prior records from the current attempt by time and identity; readers must understand schema 3 before installing this update. A propagated deadline/Stop exception is not proof of the initiating cause; live preparation failures remain unexplained until the retained checks establish it. Healthy liveness performs no diagnostic writes.

Recovery observations distinguish an unset failure (`failureSet=false`, empty
`recoveryFailure`) from an unknown set failure. Their optional bounded
`recoveryDiagnostic` projection records allowlisted operation, initial episode
trigger, latest phase transition and refusal, generation, episode/operation age
and signed episode time remaining. Per-episode counters record unavailable
observation attempts, changes between valid observed fingerprints, stale
admission refusals and apply intents. Repeated identical fingerprints do not
count as changes; a new episode resets the counters and stage timings. The
observation, preflight and apply timings retain the greatest completed elapsed
duration in that episode, capped at one day; counters cap at one million.
An in-progress native call has operation age but no completed duration yet.
The failed reducer retains its initiating operation even after clearing the
dispatch field. Older journals without these counters project zeroes. Invalid
numeric evidence yields an unavailable capture, and unknown enums become
`other`. The projection excludes fingerprints, addresses, routes, SSIDs,
provider output and exception text. These fields share existing state/failure
writes and add no provider probes. The 120-second episode, hard deadline,
two-second observation admission, isolation and mutex behavior remain the
same; the evidence does not identify or fix a timeout cause by itself.

Ordinary session exceptions also retain a separate protected
`C:\ProgramData\ITInventoryLocalRunner\session-failures.json`. Schema 1 contains at
most eight validated session GUIDs, each with the first failure and latest secondary
failure, plus an optional recorded VM GUID. A missing VM GUID means attribution was
unavailable, never that a VM is absent. The owner catch captures the initiating
exception before cleanup; cleanup failures update only the latest record. Capture
is best effort. Existing cleanup mutex/provider failures can still affect the
propagated error; the retained first diagnostic identifies the initiating failure
when publication succeeded. The supervisor fallback adds a
session only when it has no existing record. Later idle inspection errors cannot
replace session evidence. Successful sessions add no records.

The complete UTF-8 journal is capped at 16 KiB, checked before reading existing
bytes and again before publication. Oldest entries by last recorded failure are
evicted when a ninth session is added; there are no per-session files or archives.
The record survives canonical session cleanup and bundle updates. Each failure
contains only UTC time, an allowlisted stage, capture availability, allowlisted
source basename and numeric script line, allowlisted exception type, integer
HResult, allowlisted error category/error-ID class, and a fixed execution failure
class with an optional integer exit code. The receipt monitor tags invalid receipt
syntax/identity as `receipt-invalid` and a validated nonzero runner exit as
`runner-exit`; arbitrary messages are never interpreted to infer these classes.
Unknown values become `other`. Messages, stack traces, full paths, arguments,
target objects, exception data objects, environment/authentication values and
guest output are omitted rather than text-sanitized.

For an owner-approved diagnostic read, use an elevated shell and the installed
`bin\Common.ps1` helpers: check the protected file is at most 16 KiB before
`Read-RunnerJson`, then call `Assert-RunnerSessionFailureJournal` before extracting
the exact session entry. Preserve a corrupt or oversized journal for separate
investigation; writers refuse to replace it and emit only
`RUNNER_SESSION_FAILURE_CAPTURE_UNAVAILABLE`. Capture and lock-release failures
are best effort and cannot change canonical cleanup, authorize pickup or relaunch,
or turn an unknown failure into healthy state. `Session.Failure.Tests.ps1`, in the
canonical contract gate, executes the projection, atomic publication, bounded
retention, real receipt-monitor error branches and owner catch/finally under
Windows PowerShell 5.1 with disposable files and mocked host providers.

Protected state readers share the writers' existing reentrant state mutex across existence and JSON reads. Session liveness evaluates its fresh state and Stop decision coherently under that mutex, samples time after lock waits, and releases the mutex before recovery waits. A captured session exception is persisted before that invocation's canonical cleanup removes ephemeral state, preserving its original observed decision rather than reconstructing it from later state. Missing state and invalid identity still fail closed. Canonical native publication stress reproduced a sharing exception with unlocked readers; the locked fixture completed 1000 writes and 10034 reads without errors or nulls. Only an earlier noncanonical null-backup stress returned null. Cleanup-order regressions establish attached-observation retention. These checks prove the repaired source contracts; a live `state-absent` observation alone does not identify who removed state or prove the initiating cause.

After the credential-free builder shuts down gracefully and its exact Off VM registration is authoritatively removed, the owner commits a sealed preparation state with the scrub proof, image binding and fenced recovery generation. The guardian remains active while bulk disk copying runs outside the state mutex. Its sealed supervision path checks the exact preparation identity, owner/guardian processes, Stop, deadlines, progress, committed proof, authoritative VM absence and remaining disk/configuration references before refreshing progress. It never treats a missing ordinary job or verifier VM as a preparation seal, resumes a removed VM or accepts old network/probe outcomes. Watchdog and session liveness retain the same guards. Session liveness samples evaluation time after heartbeat and the fresh protected-state read, then rechecks Stop and the current deadline; guardian progress that advanced during the mutex wait is evaluated against that later time, while true future progress still refuses continuation. Candidate retention still requires fresh post-copy proof and unchanged image selection. Provider uncertainty, reappearing registration, cancellation or invalid proof fails closed through canonical cleanup.

While the exact owned adapter is disconnected and its VM is Off or Paused, policy replacement queries its existing ACL objects and removes each with the supported [InputObject parameter set](https://learn.microsoft.com/en-us/powershell/module/hyper-v/remove-vmnetworkadapterextendedacl?view=windowsserver2025-ps). A fresh adapter with no ACLs skips removal. A second query must prove the old policy empty before any replacement rule is added; query/removal failures or surviving rules fail closed through canonical cleanup. Exact post-add readback remains required before reconnect or resume.

Healthy execution also requires the bound adapter to remain connected to its exact switch. Unexpected detachment of that same adapter triggers quarantine and guarded recovery even when the host fingerprint is unchanged; detachment during connection, resume or probing cannot accept an obsolete successful outcome or extend the original outage/hard deadline. Intended isolation still allows a disconnected adapter. Immediately before the sole JIT intent, active demand or exact pilot queue evidence is read after any guardian recovery wait; withdrawn demand cannot register an idle runner using evidence from before the outage. A fresh protected healthy guardian binding and recovery generation are captured before that remote lookup and checked without waiting under the intent mutex. Guardian death, lost readiness, expiry or an intervening recovery (even one already healthy again) refuses registration and cleans up this session rather than reusing obsolete demand.

Postresume isolation/TLS checks run in a fixed read-only host worker while the guardian continues observing. The worker starts suspended and joins a Windows Job Object before resume; the guardian owns the sole noninherited handle, with KILL_ON_JOB_CLOSE and no breakaway. This job never contains the guest workflow or Hyper-V mutations. Results use bounded protected nonce/generation files. Cancellation terminates and verifies a bounded descendant drain; obsolete results cannot authorize continuation. Boot still dispatches the verified VM object/GUID to Start-VM -AsJob and waits outside the lock with fresh identity/running-state readback. Cancelling a PowerShell boot job is not proof of provider cancellation. Synchronous Windows management calls have no proven cancellable timeout: a hung call holding the state mutex can delay Stop/watchdog cleanup beyond the episode deadline. Inspection, lock acquisition, bounded probe drain and provider execution create a nonzero detection/containment window; this is not instantaneous isolation or a universal wall-clock guarantee.

JIT registration and launch are journaled before their respective dispatches. A separate protected, nonsecret `jit-registration.json` commits the exact operation, repository, generated VM/runner name, GUID, owner, requested labels/group and validated runner ID outside ephemeral session state. A lost registration response or process exit leaves this barrier intact through VM cleanup and updates, blocking new claims, pilot retry and activation. Boot and manual Supervise entry recheck lifecycle transitions and the coherent installed manifest, receipt and dependency hashes under the supervisor lifetime and publication state locks before stale cleanup or registration reconciliation; the state lock is released before network reads. Before demand inspection, the supervisor reconciles abandoned registrations, including handed-off records, after authoritative exact local cleanup/reference checks. Each remote inventory is outside the state mutex, complete and bounded to at most 100 repository runners. The sole exact-name, exact-label, offline/nonbusy positive ID must remain eligible in a fresh snapshot after local proof and removal-intent persistence, followed by another same-operation/local-absence and fresh protected repository-config check before DELETE. This is a fresh admission check, not an atomic GitHub eligibility predicate. The requested group is original request evidence, not a remotely verified group. An empty unknown-ID result cannot exclude a late POST and remains blocked; a lost DELETE response is resolved only by complete subsequent ID/name absence. Ambiguous, active, incomplete or failed evidence remains blocked with a nonsecret transport/evidence diagnostic. Validated registration and a durable handoff precede SSH; partial writes and late responses cannot authorize launch. Dispatch rechecks canonical current healthy/readiness, live guardian, claim/binding, Stop and deadline admission inside the state mutex before any launch decision or handoff write. A validated registration response remains durable during recovery. The mutex is released before SSH: a subsequent quarantine can still cause transport failure, so this is not a zero-race transport guarantee and never authorizes replacement registration or launch replay. A committed handoff transfers execution to the existing launch/receipt protocol while retaining the registration barrier. After exact local abandonment, a known registered or handed-off ID completes only when a complete validated inventory proves both ID and name absent, or the exact offline/nonbusy registration is removed and subsequent absence verified. Busy/online runners, identity collisions and transport uncertainty remain blocked. The original consumed pilot receipt is retained. Controller restart admission validates the journal while allowing a valid unresolved barrier so the sole supervisor can reconcile it; new VM/JIT claim admission remains closed. Stop, transition, idle, configuration, installed-bundle coherence and malformed-journal refusal remain in force. The one fixed guest runner launches once in a private systemd service with Restart=no, preserving its prepared/cold environment. Only its one-use JIT input enters the guest. SSH loss reattaches a bounded read-only receipt monitor for the same launch nonce and runner ID; it never obtains another JIT, relaunches the service or replays workflow steps. A guest exit receipt signals session cleanup (`runner-exited`), and a nonzero exit remains abnormal. GitHub remains authoritative for job/workflow results; existing exact pilot workflow/run/attempt/job/runner verification is unchanged. Recovery is best effort: arbitrary TCP or command timeouts can still fail the same job. Real network-switch continuity requires proof of one VM, one runner, one JIT and the same GitHub job/attempt.

Before enabling active pickup on the live host, security evidence must establish the exact ACL and guardian on Windows: live guest isolation, established-flow containment across route/address changes, quarantine/recovery and flap/deadline cleanup, Stop and process-loss cleanup, real GitHub assignment, same-job transport continuity, and normal one-job exit/cleanup. Provisional creation and boot recovery also require verification. Active pickup needs the owner's explicit acceptance of the measured residual window and independent review. The exact-SHA diagnostic Docker pilot proves assignment and basic guest readiness; it does not certify Supabase or Playwright. After normal job routing is enabled for the live host, the first normal PR CI run must exercise the full Supabase/Playwright workload and pass the complete repository gate before PR readiness. Repository label changes alone are not evidence that host security acceptance, activation, or workload certification has occurred.

Source contract validation performs no host provisioning, elevation, credential creation, VM/WSL/NAT/task creation, or GitHub registration. Windows PowerShell 5.1 syntax and non-mutating contract checks cover native argument fidelity, lifecycle readback, provisional cleanup, serialized recovery, synthetic network drift and inspection failure, cancelled boot, converter retirement, menu activation order, real-process claim/suspension races, fail-fast concurrent owner controls, abrupt claim-process loss, and every final setup publication interruption. Offline checks do not substitute for real Hyper-V networking, disk creation, guest boot, shutdown recovery or a working runner job. Preserve exact-revision runtime pilot evidence separately, complete independent review, and apply the security and workload gates above. A new installation leaves pickup disabled until the operator explicitly enables it. Installed activation or a passing pilot does not waive the complete normal-workload gate. Record real reboot recovery separately from synthetic interruption/recovery checks; do not infer reboot proof from those checks or from configured boot tasks.

Official references: [GitHub repository JIT runner API](https://docs.github.com/en/rest/actions/self-hosted-runners), [GitHub workflow job API](https://docs.github.com/en/rest/actions/workflow-jobs), [Ubuntu cloud-init NoCloud](https://docs.cloud-init.io/en/latest/reference/datasources/nocloud.html), [Microsoft Hyper-V NAT](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/setup-nat-network), and [Microsoft Hyper-V extended ACLs](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/create-security-policies-extended-port-access-control-lists).
