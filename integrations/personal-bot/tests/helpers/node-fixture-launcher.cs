using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

class NodeFixtureLauncher {
  [StructLayout(LayoutKind.Sequential)]
  struct BasicLimits {
    public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimits {
    public BasicLimits BasicLimitInformation;
    public IoCounters IoInfo;
    public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
  }
  [DllImport("kernel32.dll")] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int informationClass, ref ExtendedLimits limits, uint length);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  static int Main() {
    string[] configuration = File.ReadAllLines(Assembly.GetExecutingAssembly().Location + ".paths");
    var job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) return 1;
    try {
      var limits = new ExtendedLimits();
      // The fixture's Node process must also close if its launcher is terminated.
      limits.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
      if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits))) return 1;
      var start = new ProcessStartInfo(configuration[0], "\"" + configuration[1] + "\"");
      start.UseShellExecute = false;
      start.CreateNoWindow = true;
      start.RedirectStandardInput = true;
      start.RedirectStandardOutput = true;
      start.RedirectStandardError = true;
      using (var child = Process.Start(start)) {
        if (!AssignProcessToJobObject(job, child.Handle)) {
          if (!child.HasExited) child.Kill();
          return 1;
        }
        var output = child.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
        var error = child.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
        Console.OpenStandardInput().CopyTo(child.StandardInput.BaseStream);
        child.StandardInput.Close();
        child.WaitForExit();
        System.Threading.Tasks.Task.WaitAll(output, error);
        return child.ExitCode;
      }
    } finally { CloseHandle(job); }
  }
}
