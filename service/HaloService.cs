// Halo Service — служба Windows, которая запускает ядро mihomo с правами SYSTEM по команде клиента Halo.
// Нужна для TUN-режима без запуска всего приложения от имени администратора (как clash-verge-service).
//
// Канал: \\.\pipe\halo-service, одна строка JSON на запрос и одна на ответ.
// Каждый запрос несёт секрет из файла, путь к которому задан при установке (лежит в профиле пользователя).
// Ядро запускается только своё — mihomo.exe рядом со службой в Program Files, путь от клиента не принимается.
//
// halo-service.exe install <файл-секрета> <mihomo.exe> [журнал]  — скопировать в Program Files, зарегистрировать и запустить
// halo-service.exe uninstall [журнал]                           — остановить и удалить
// Журнал: при запуске через UAC вывод теряется, поэтому причина сбоя пишется в этот файл — клиент показывает её пользователю.
// halo-service.exe run <файл-секрета> [mihomo.exe]     — то же самое в консоли, для отладки
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

static class Program
{
    public const string ServiceName = "HaloService";
    public const string Version = "1";

    static int Main(string[] args)
    {
        string verb = args.Length > 0 ? args[0] : "";
        string errorLog = verb == "install" && args.Length > 3 ? args[3] : verb == "uninstall" && args.Length > 1 ? args[1] : null;
        try
        {
            switch (verb)
            {
                case "--service":
                    ServiceBase.Run(new HaloService(args[1], Path.Combine(ExeDir(), "mihomo.exe")));
                    return 0;
                case "install":
                    return Installer.Install(args[1], args[2]);
                case "uninstall":
                    return Installer.Uninstall();
                case "run":
                    var server = new Server(args[1], args.Length > 2 ? args[2] : Path.Combine(ExeDir(), "mihomo.exe"));
                    server.Start();
                    Console.WriteLine("Halo Service слушает \\\\.\\pipe\\halo-service, Enter — выход");
                    Console.ReadLine();
                    server.Stop();
                    return 0;
                default:
                    Console.Error.WriteLine("halo-service.exe install <secret> <mihomo.exe> | uninstall | run <secret> [mihomo.exe]");
                    return 2;
            }
        }
        catch (Exception e)
        {
            Console.Error.WriteLine(e.Message);
            if (errorLog != null)
            {
                try { File.WriteAllText(errorLog, e.Message, Encoding.UTF8); } catch { /* некуда писать */ }
            }
            return 1;
        }
    }

    public static string ExeDir()
    {
        return Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName);
    }
}

class HaloService : ServiceBase
{
    readonly Server server;

    public HaloService(string secretFile, string corePath)
    {
        ServiceName = Program.ServiceName;
        server = new Server(secretFile, corePath);
    }

    protected override void OnStart(string[] args) { server.Start(); }
    protected override void OnStop() { StopAndExit(); }
    protected override void OnShutdown() { StopAndExit(); }

    // Если после остановки процесс не завершился сам (какой-то поток не отпустил), через 3 с завершаем его,
    // иначе служба зависает в STOP_PENDING и её нельзя ни переустановить, ни удалить.
    void StopAndExit()
    {
        server.Stop();
        new Thread(() =>
        {
            Thread.Sleep(3000);
            Environment.Exit(0);
        }) { IsBackground = true }.Start();
    }
}

class Server
{
    const string PipeName = "halo-service";
    const int MaxLogs = 300;

    readonly string secretFile;
    readonly string corePath;
    readonly string coreHash;
    readonly object sync = new object();
    readonly ManualResetEvent stopping = new ManualResetEvent(false);
    readonly List<KeyValuePair<long, string>> logs = new List<KeyValuePair<long, string>>();
    long seq;
    Process core;
    int? exitCode;
    int ownerPid;
    DateTime ownerStart;
    Timer ownerWatch;
    Thread acceptThread;

    public Server(string secretFile, string corePath)
    {
        this.secretFile = secretFile;
        this.corePath = corePath;
        coreHash = File.Exists(corePath) ? Sha256(corePath) : "";
    }

    public void Start()
    {
        acceptThread = new Thread(AcceptLoop) { IsBackground = true };
        acceptThread.Start();
    }

    public void Stop()
    {
        stopping.Set();
        lock (sync) StopCore();
    }

    // ---------- Канал ----------

    void AcceptLoop()
    {
        while (!stopping.WaitOne(0))
        {
            NamedPipeServerStream pipe;
            try
            {
                pipe = new NamedPipeServerStream(PipeName, PipeDirection.InOut, NamedPipeServerStream.MaxAllowedServerInstances,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536, PipeAcl());
            }
            catch
            {
                Thread.Sleep(500);
                continue;
            }
            var ar = pipe.BeginWaitForConnection(null, null);
            if (WaitHandle.WaitAny(new[] { stopping, ar.AsyncWaitHandle }) == 0)
            {
                pipe.Dispose();
                return;
            }
            try
            {
                pipe.EndWaitForConnection(ar);
                ThreadPool.QueueUserWorkItem(_ => Serve(pipe));
            }
            catch
            {
                pipe.Dispose();
            }
        }
    }

    static PipeSecurity PipeAcl()
    {
        var acl = new PipeSecurity();
        acl.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null),
            PipeAccessRights.ReadWrite, AccessControlType.Allow));
        acl.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null),
            PipeAccessRights.FullControl, AccessControlType.Allow));
        acl.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null),
            PipeAccessRights.FullControl, AccessControlType.Allow));
        // Тому, кто создал канал (SYSTEM у службы, пользователь в режиме run), нужно право создавать новые экземпляры.
        acl.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
        return acl;
    }

    void Serve(NamedPipeServerStream pipe)
    {
        var json = new JavaScriptSerializer();
        using (pipe)
        {
            Dictionary<string, object> reply;
            try
            {
                string line = ReadLine(pipe, 65536);
                var req = json.Deserialize<Dictionary<string, object>>(line);
                reply = Handle(req);
            }
            catch (Exception e)
            {
                reply = new Dictionary<string, object> { { "ok", false }, { "error", e.Message } };
            }
            try
            {
                byte[] bytes = Encoding.UTF8.GetBytes(json.Serialize(reply) + "\n");
                pipe.Write(bytes, 0, bytes.Length);
                pipe.Flush();
                pipe.WaitForPipeDrain();
            }
            catch
            {
                /* клиент ушёл */
            }
        }
    }

    static string ReadLine(Stream s, int max)
    {
        var buf = new MemoryStream();
        int b;
        while ((b = s.ReadByte()) >= 0 && b != '\n')
        {
            buf.WriteByte((byte)b);
            if (buf.Length > max) throw new Exception("Слишком длинный запрос");
        }
        return Encoding.UTF8.GetString(buf.ToArray());
    }

    // ---------- Команды ----------

    Dictionary<string, object> Handle(Dictionary<string, object> req)
    {
        if (!SecretOk(Str(req, "secret"))) throw new Exception("Неверный секрет");
        string cmd = Str(req, "cmd");
        lock (sync)
        {
            if (cmd == "start") StartCore(Str(req, "configPath"), Str(req, "workDir"), Convert.ToInt32(req.ContainsKey("ownerPid") ? req["ownerPid"] : 0));
            else if (cmd == "stop") StopCore();
            else if (cmd != "status") throw new Exception("Неизвестная команда: " + cmd);
            return Status(req.ContainsKey("since") ? Convert.ToInt64(req["since"]) : 0);
        }
    }

    Dictionary<string, object> Status(long since)
    {
        var lines = new List<object>();
        foreach (var l in logs) if (l.Key > since) lines.Add(l.Value);
        return new Dictionary<string, object>
        {
            { "ok", true },
            { "version", Program.Version },
            { "coreHash", coreHash },
            { "running", core != null },
            { "pid", core != null ? (object)core.Id : null },
            { "exitCode", exitCode },
            { "seq", seq },
            { "logs", lines },
        };
    }

    void StartCore(string configPath, string workDir, int owner)
    {
        if (!File.Exists(corePath)) throw new Exception("Не найдено ядро: " + corePath);
        CheckPath(configPath);
        CheckPath(workDir);
        string ext = Path.GetExtension(configPath).ToLowerInvariant();
        if (ext != ".yaml" && ext != ".yml") throw new Exception("Конфиг должен быть .yaml");
        if (!File.Exists(configPath)) throw new Exception("Нет файла конфига: " + configPath);
        if (!Directory.Exists(workDir)) throw new Exception("Нет рабочей папки: " + workDir);

        StopCore();
        exitCode = null;
        var psi = new ProcessStartInfo(corePath, "-d \"" + workDir.TrimEnd('\\') + "\" -f \"" + configPath + "\"")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = workDir,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
        p.OutputDataReceived += (_, e) => AddLog(e.Data);
        p.ErrorDataReceived += (_, e) => AddLog(e.Data);
        p.Exited += (_, e) =>
        {
            lock (sync)
            {
                if (core != p) return;
                exitCode = SafeExitCode(p);
                core = null;
                StopOwnerWatch();
            }
        };
        p.Start();
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        core = p;
        WatchOwner(owner);
    }

    void StopCore()
    {
        StopOwnerWatch();
        var p = core;
        core = null;
        if (p == null) return;
        try
        {
            if (!p.HasExited)
            {
                p.Kill();
                p.WaitForExit(5000);
            }
            exitCode = SafeExitCode(p);
        }
        catch
        {
            /* уже завершён */
        }
    }

    // Если Halo закрылся аварийно, ядро (и TUN) не должно остаться висеть.
    void WatchOwner(int pid)
    {
        if (pid <= 0) return;
        try
        {
            ownerPid = pid;
            ownerStart = Process.GetProcessById(pid).StartTime;
        }
        catch
        {
            return;
        }
        ownerWatch = new Timer(_ =>
        {
            lock (sync)
            {
                if (ownerWatch == null || OwnerAlive()) return;
                AddLog("Halo Service: клиент завершился, ядро остановлено");
                StopCore();
            }
        }, null, 2000, 2000);
    }

    bool OwnerAlive()
    {
        try
        {
            var p = Process.GetProcessById(ownerPid);
            return !p.HasExited && p.StartTime == ownerStart;
        }
        catch
        {
            return false;
        }
    }

    void StopOwnerWatch()
    {
        if (ownerWatch != null) ownerWatch.Dispose();
        ownerWatch = null;
    }

    void AddLog(string line)
    {
        if (string.IsNullOrEmpty(line)) return;
        lock (sync)
        {
            logs.Add(new KeyValuePair<long, string>(++seq, line));
            if (logs.Count > MaxLogs) logs.RemoveAt(0);
        }
    }

    // ---------- Проверки ----------

    bool SecretOk(string given)
    {
        string expected;
        try
        {
            expected = File.ReadAllText(secretFile).Trim();
        }
        catch
        {
            return false;
        }
        if (expected.Length < 16 || given == null || given.Length != expected.Length) return false;
        int diff = 0;
        for (int i = 0; i < given.Length; i++) diff |= given[i] ^ expected[i];
        return diff == 0;
    }

    static void CheckPath(string p)
    {
        if (string.IsNullOrEmpty(p) || !Path.IsPathRooted(p) || p.StartsWith("\\\\") || p.IndexOf('"') >= 0)
            throw new Exception("Недопустимый путь: " + p);
    }

    static string Str(Dictionary<string, object> d, string key)
    {
        object v;
        return d.TryGetValue(key, out v) && v != null ? v.ToString() : null;
    }

    static int? SafeExitCode(Process p)
    {
        try { return p.ExitCode; } catch { return null; }
    }

    public static string Sha256(string file)
    {
        using (var sha = SHA256.Create())
        using (var f = File.OpenRead(file))
            return BitConverter.ToString(sha.ComputeHash(f)).Replace("-", "").ToLowerInvariant();
    }
}

static class Installer
{
    static string InstallDir()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Halo Service");
    }

    public static int Install(string secretFile, string coreSrc)
    {
        if (!File.Exists(secretFile)) throw new Exception("Нет файла секрета: " + secretFile);
        if (!File.Exists(coreSrc)) throw new Exception("Нет ядра: " + coreSrc);
        RemoveService();

        // Копия в Program Files: туда может писать только администратор, значит подменить exe службы нельзя.
        string dir = InstallDir();
        Directory.CreateDirectory(dir);
        string exe = Path.Combine(dir, "halo-service.exe");
        Retry(() => File.Copy(Process.GetCurrentProcess().MainModule.FileName, exe, true));
        Retry(() => File.Copy(coreSrc, Path.Combine(dir, "mihomo.exe"), true));

        string binPath = "\"" + exe + "\" --service \"" + Path.GetFullPath(secretFile) + "\"";
        Sc("create", Program.ServiceName, "binPath=", binPath, "start=", "auto", "DisplayName=", "Halo Service");
        Sc("description", Program.ServiceName, "Запускает ядро mihomo для TUN-режима Halo без прав администратора у приложения");
        Sc("failure", Program.ServiceName, "reset=", "86400", "actions=", "restart/5000/restart/5000//");
        Sc("start", Program.ServiceName);
        return 0;
    }

    public static int Uninstall()
    {
        RemoveService();
        string dir = InstallDir();
        if (Directory.Exists(dir))
        {
            try
            {
                Retry(() => Directory.Delete(dir, true));
            }
            catch
            {
                /* удалим при следующей установке */
            }
        }
        return 0;
    }

    static void RemoveService()
    {
        using (var sc = Find())
        {
            if (sc != null)
            {
                try
                {
                    if (sc.Status == ServiceControllerStatus.Running || sc.Status == ServiceControllerStatus.Paused) sc.Stop();
                    sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(10));
                }
                catch
                {
                    /* не остановилась вовремя или уже остановлена — добьём ниже */
                }
            }
        }
        // Служба зависла в STOP_PENDING — завершаем её процесс. И ядро из папки службы, если осталось.
        KillServiceProcess();
        KillFromDir(InstallDir());
        Sc("delete", Program.ServiceName);
        for (int i = 0; i < 60; i++)
        {
            using (var sc = Find()) if (sc == null) return;
            Thread.Sleep(250);
        }
        throw new Exception("Windows не удаляет старую службу Halo. Закройте «Службы» (services.msc), если открыто, и повторите");
    }

    static void KillServiceProcess()
    {
        // sc queryex печатает строку вида «PID : 4208».
        var p = Process.Start(new ProcessStartInfo("sc.exe", "queryex " + Program.ServiceName)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
        });
        string output = p.StandardOutput.ReadToEnd();
        p.WaitForExit();
        foreach (var line in output.Split('\n'))
        {
            int colon = line.IndexOf(':');
            if (colon < 0 || line.IndexOf("PID", StringComparison.OrdinalIgnoreCase) < 0) continue;
            int pid;
            if (!int.TryParse(line.Substring(colon + 1).Trim(), out pid) || pid <= 4 || pid == Process.GetCurrentProcess().Id) continue;
            try
            {
                var proc = Process.GetProcessById(pid);
                proc.Kill();
                proc.WaitForExit(5000);
            }
            catch
            {
                /* уже завершилась */
            }
        }
    }

    static void KillFromDir(string dir)
    {
        string full = Path.GetFullPath(dir).TrimEnd('\\') + "\\";
        foreach (var name in new[] { "mihomo", "halo-service" })
        {
            foreach (var proc in Process.GetProcessesByName(name))
            {
                try
                {
                    if (proc.Id == Process.GetCurrentProcess().Id) continue;
                    if (!proc.MainModule.FileName.StartsWith(full, StringComparison.OrdinalIgnoreCase)) continue;
                    proc.Kill();
                    proc.WaitForExit(5000);
                }
                catch
                {
                    /* нет доступа или уже завершён */
                }
                finally
                {
                    proc.Dispose();
                }
            }
        }
    }

    static ServiceController Find()
    {
        foreach (var s in ServiceController.GetServices())
        {
            if (s.ServiceName == Program.ServiceName) return s;
            s.Dispose();
        }
        return null;
    }

    static void Sc(params string[] args)
    {
        var sb = new StringBuilder();
        foreach (var a in args)
        {
            if (sb.Length > 0) sb.Append(' ');
            sb.Append(a.IndexOf(' ') >= 0 || a.IndexOf('"') >= 0 ? "\"" + a.Replace("\"", "\\\"") + "\"" : a);
        }
        var p = Process.Start(new ProcessStartInfo("sc.exe", sb.ToString())
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
        });
        string output = p.StandardOutput.ReadToEnd();
        p.WaitForExit();
        // 1060 — службы нет (delete до установки), 1056 — уже запущена.
        if (p.ExitCode != 0 && p.ExitCode != 1060 && p.ExitCode != 1056)
            throw new Exception("sc " + args[0] + ": " + output.Trim());
    }

    static void Retry(Action a)
    {
        for (int i = 0; ; i++)
        {
            try
            {
                a();
                return;
            }
            catch
            {
                if (i >= 40) throw;
                Thread.Sleep(250);
            }
        }
    }
}
