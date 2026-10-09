# Narrow lifetime owner for the fixed, read-only recovery probe. Never used for
# Hyper-V operations or the guest workflow. Loading compiles the type without
# launching a probe or changing VM/network/control state.
if (-not ('ITIR.ProbeJob' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;
namespace ITIR {
    public sealed class ProbeJob : IDisposable {
        [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
            public long ProcessTime, JobTime; public uint Flags;
            public UIntPtr Minimum, Maximum; public uint ActiveLimit; public UIntPtr Affinity;
            public uint Priority, Scheduling;
        }
        [StructLayout(LayoutKind.Sequential)] struct Counters {
            public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
        }
        [StructLayout(LayoutKind.Sequential)] struct Limits {
            public BasicLimits Basic; public Counters Io;
            public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
        }
        [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
            public uint Size; public string Reserved, Desktop, Title;
            public uint X,Y,XSize,YSize,XChars,YChars,Fill,Flags;
            public ushort Show, ReservedSize; public IntPtr ReservedBytes, Input, Output, Error;
        }
        [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
            public IntPtr Process, Thread; public uint ProcessId, ThreadId;
        }
        [StructLayout(LayoutKind.Sequential)] struct Accounting {
            public long User, Kernel, PeriodUser, PeriodKernel;
            public uint PageFaults, Total, Active, Terminated;
        }
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        static extern IntPtr CreateJobObject(IntPtr security, string name);
        [DllImport("kernel32.dll", SetLastError=true)]
        static extern bool SetInformationJobObject(IntPtr job, int type, ref Limits info, uint length);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        static extern bool CreateProcess(string application, System.Text.StringBuilder command, IntPtr processSecurity,
            IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string directory, ref Startup startup, out ProcessInfo info);
        [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint exit);
        [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint exit);
        [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int type, out Accounting info, uint length, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint exit);
        [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        IntPtr job, process;
        public uint ProcessId { get; private set; }
        static Exception Failure(string operation) { return new Win32Exception(Marshal.GetLastWin32Error(), operation); }
        public ProbeJob(string executable, string arguments) {
            ProcessInfo info = new ProcessInfo(); bool assigned = false;
            job = CreateJobObject(IntPtr.Zero, null); // Noninherited guardian-only handle.
            if (job == IntPtr.Zero) throw Failure("Probe job creation failed.");
            try {
                Limits limits = new Limits(); limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE, no breakaway flags.
                if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(Limits)))) throw Failure("Probe job lifetime policy failed.");
                Startup startup = new Startup(); startup.Size = (uint)Marshal.SizeOf(typeof(Startup));
                var command = new System.Text.StringBuilder("\"" + executable + "\" " + arguments);
                if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, false, 0x08000004,
                    IntPtr.Zero, null, ref startup, out info)) throw Failure("Suspended probe creation failed.");
                // Worker has executed no instruction and cannot spawn descendants yet.
                if (!AssignProcessToJobObject(job, info.Process)) throw Failure("Suspended probe assignment failed.");
                assigned = true;
                if (ResumeThread(info.Thread) == UInt32.MaxValue) throw Failure("Assigned probe resume failed.");
                process = info.Process; ProcessId = info.ProcessId; info.Process = IntPtr.Zero;
            } catch {
                if (assigned) TerminateJobObject(job, 125);
                else if (info.Process != IntPtr.Zero) TerminateProcess(info.Process, 125);
                if (info.Process != IntPtr.Zero) {
                    uint wait = WaitForSingleObject(info.Process, 2000);
                    if (wait != 0) throw new InvalidOperationException("Suspended probe failure cleanup is uncertain.");
                }
                throw;
            } finally {
                if (info.Thread != IntPtr.Zero) CloseHandle(info.Thread);
                if (info.Process != IntPtr.Zero) CloseHandle(info.Process);
                if (process == IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
            }
        }
        public bool Completed {
            get {
                if (process == IntPtr.Zero) throw new ObjectDisposedException("ProbeJob");
                uint status = WaitForSingleObject(process, 0);
                if (status != 0 && status != 258) throw Failure("Probe completion readback failed.");
                return status == 0;
            }
        }
        public uint ExitCode {
            get { uint code; if (!GetExitCodeProcess(process, out code)) throw Failure("Probe exit readback failed."); return code; }
        }
        public void CancelAndDrain() {
            if (job == IntPtr.Zero) return;
            try {
                if (!TerminateJobObject(job, 125)) throw Failure("Probe termination failed.");
                var deadline = DateTime.UtcNow.AddSeconds(2);
                while (true) {
                    Accounting count;
                    if (!QueryInformationJobObject(job, 1, out count, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero)) throw Failure("Probe lifetime readback failed.");
                    if (count.Active == 0) return;
                    if (DateTime.UtcNow >= deadline) throw new InvalidOperationException("Probe descendants did not drain within two seconds.");
                    Thread.Sleep(20);
                }
            } finally { Dispose(); }
        }
        public void Dispose() {
            // Closing the only job handle also kills descendants on guardian exit.
            if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
            if (process != IntPtr.Zero) { CloseHandle(process); process = IntPtr.Zero; }
            GC.SuppressFinalize(this);
        }
        ~ProbeJob() { Dispose(); }
    }
}
'@
}
