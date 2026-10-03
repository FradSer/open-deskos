// The Windows process reader for the Display Shell.
//
// It exists because one fact the desk states truthfully cannot be reached from
// JavaScript on this host: the working directory of another process. Windows
// exposes it only through the target's PEB, so this module reads the process
// table with Toolhelp32Snapshot, start times with GetProcessTimes, and the
// command line and current directory with one ReadProcessMemory of the target's
// process parameters block.
//
// Every failure is a smaller truth, never an error the shell has to survive: a
// process that cannot be read is still reported by identity and start time with
// an empty directory, and a process that cannot be enumerated at all is not
// reported.
//
// Windows only. scripts/build-native.mjs refuses to build this anywhere else.

#include <napi.h>
#include <windows.h>
#include <tlhelp32.h>
#include <winternl.h>

#include <string>
#include <vector>

namespace {

// Offsets into a 64-bit target's PEB and RTL_USER_PROCESS_PARAMETERS. A 32-bit
// (WOW64) target lays these out differently, so it is left unread rather than
// decoded with the wrong layout.
const SIZE_T kPebProcessParametersOffset = 0x20;
const SIZE_T kProcessParametersCurrentDirectoryOffset = 0x38;
const SIZE_T kProcessParametersCommandLineOffset = 0x70;
const ULONG kProcessBasicInformation = 0;

struct ProcessBasicInformation {
  NTSTATUS ExitStatus;
  PVOID PebBaseAddress;
  ULONG_PTR AffinityMask;
  LONG BasePriority;
  ULONG_PTR UniqueProcessId;
  ULONG_PTR InheritedFromUniqueProcessId;
};

using NtQueryInformationProcessFn = NTSTATUS(NTAPI*)(HANDLE, ULONG, PVOID, ULONG, PULONG);

NtQueryInformationProcessFn queryProcessInformation() {
  static NtQueryInformationProcessFn cached = reinterpret_cast<NtQueryInformationProcessFn>(
      GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryInformationProcess"));
  return cached;
}

std::string toUtf8(const std::wstring& value) {
  if (value.empty()) return std::string();
  const int size = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (size <= 0) return std::string();
  std::string out(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), out.data(), size, nullptr, nullptr);
  return out;
}

std::wstring normalizeDosPath(const std::wstring& path) {
  // The PEB records an NT path such as "\??\C:\work". The desk states the path
  // a user recognizes, so the device prefix is removed.
  const std::wstring ntPrefix = L"\\??\\";
  if (path.size() >= ntPrefix.size() && path.compare(0, ntPrefix.size(), ntPrefix) == 0) {
    return path.substr(ntPrefix.size());
  }
  return path;
}

bool readWideString(HANDLE process, const UNICODE_STRING& value, std::wstring& out) {
  // A foreign PEB can report an odd byte length; only whole characters are read.
  const SIZE_T bytes = (static_cast<SIZE_T>(value.Length) / sizeof(wchar_t)) * sizeof(wchar_t);
  if (!value.Buffer || bytes == 0) return false;
  std::wstring buffer(bytes / sizeof(wchar_t), L'\0');
  SIZE_T read = 0;
  if (!ReadProcessMemory(process, value.Buffer, buffer.data(), bytes, &read)) return false;
  if (read != bytes) return false;
  out = std::move(buffer);
  return true;
}

template <typename T>
bool readStructure(HANDLE process, const BYTE* address, T& value) {
  SIZE_T read = 0;
  if (!ReadProcessMemory(process, address, &value, sizeof(T), &read)) return false;
  return read == sizeof(T);
}

// The command line and the current directory are read where they are, one small
// read each: a boundary near either structure cannot fail the other, and neither
// read depends on how the target arranged the rest of the block.
void readProcessParameters(HANDLE process, std::wstring& command, std::wstring& cwd) {
  const auto query = queryProcessInformation();
  if (!query) return;

  ProcessBasicInformation info = {};
  if (query(process, kProcessBasicInformation, &info, sizeof(info), nullptr) < 0) return;
  if (!info.PebBaseAddress) return;

  PVOID parameters = nullptr;
  const auto* pebSlot = reinterpret_cast<const BYTE*>(info.PebBaseAddress) + kPebProcessParametersOffset;
  if (!readStructure(process, pebSlot, parameters)) return;
  if (!parameters) return;

  const auto* base = static_cast<const BYTE*>(parameters);
  std::wstring value;
  UNICODE_STRING commandLine = {};
  if (readStructure(process, base + kProcessParametersCommandLineOffset, commandLine) && readWideString(process, commandLine, value)) {
    command = value;
  }
  UNICODE_STRING currentDirectory = {};
  if (readStructure(process, base + kProcessParametersCurrentDirectoryOffset, currentDirectory) && readWideString(process, currentDirectory, value)) {
    cwd = normalizeDosPath(value);
  }
}

// A target the shell may not read answers with an empty directory instead of an
// error, and a target it may not read at all still answers with its identity and
// start time: the two requisites are asked for separately, because a higher
// integrity level refuses PROCESS_VM_READ but not the query.
void readTarget(DWORD pid, std::wstring& command, std::wstring& cwd, double& startedAtMs) {
  HANDLE queried = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (queried) {
    FILETIME creation = {};
    FILETIME exit = {};
    FILETIME kernel = {};
    FILETIME user = {};
    if (GetProcessTimes(queried, &creation, &exit, &kernel, &user)) {
      ULARGE_INTEGER ticks;
      ticks.LowPart = creation.dwLowDateTime;
      ticks.HighPart = creation.dwHighDateTime;
      // FILETIME counts 100ns intervals from 1601-01-01.
      const unsigned long long epochDelta = 116444736000000000ULL;
      if (ticks.QuadPart > epochDelta) {
        startedAtMs = static_cast<double>((ticks.QuadPart - epochDelta) / 10000ULL);
      }
    }
    CloseHandle(queried);
  }

  HANDLE readable = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, FALSE, pid);
  if (!readable) return;
  BOOL wow64 = FALSE;
  if (IsWow64Process(readable, &wow64) && wow64) {
    CloseHandle(readable);
    return;
  }
  readProcessParameters(readable, command, cwd);
  CloseHandle(readable);
}

Napi::Value ListProcesses(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) throw Napi::Error::New(env, "process enumeration unavailable");

  std::vector<PROCESSENTRY32W> entries;
  PROCESSENTRY32W entry = {};
  entry.dwSize = sizeof(entry);
  if (Process32FirstW(snapshot, &entry)) {
    do {
      entries.push_back(entry);
      entry.dwSize = sizeof(entry);
    } while (Process32NextW(snapshot, &entry));
  }
  CloseHandle(snapshot);

  Napi::Array result = Napi::Array::New(env);
  uint32_t index = 0;
  for (const auto& item : entries) {
    const DWORD pid = item.th32ProcessID;
    if (pid == 0) continue;
    std::wstring command;
    std::wstring cwd;
    double startedAtMs = 0;
    readTarget(pid, command, cwd, startedAtMs);

    Napi::Object row = Napi::Object::New(env);
    row.Set("pid", Napi::Number::New(env, static_cast<double>(pid)));
    row.Set("ppid", Napi::Number::New(env, static_cast<double>(item.th32ParentProcessID)));
    row.Set("exe", Napi::String::New(env, toUtf8(item.szExeFile)));
    row.Set("command", Napi::String::New(env, toUtf8(command)));
    row.Set("startedAtMs", Napi::Number::New(env, startedAtMs));
    row.Set("cwd", Napi::String::New(env, toUtf8(cwd)));
    result.Set(index, row);
    index += 1;
  }
  return result;
}

Napi::Value ProcessCwd(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) throw Napi::TypeError::New(env, "processCwd requires a pid");
  const DWORD pid = static_cast<DWORD>(info[0].As<Napi::Number>().Int64Value());
  std::wstring command;
  std::wstring cwd;
  double startedAtMs = 0;
  readTarget(pid, command, cwd, startedAtMs);
  return Napi::String::New(env, toUtf8(cwd));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("listProcesses", Napi::Function::New(env, ListProcesses));
  exports.Set("processCwd", Napi::Function::New(env, ProcessCwd));
  return exports;
}

}  // namespace

NODE_API_MODULE(odk_process, Init)