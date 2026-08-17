# Diagnostico: registra cualquier ventana de navegador que aparezca, con todos
# los datos del proceso que la crea. Dejalo corriendo mientras usas el programa.
#
#   powershell -ExecutionPolicy Bypass -File diagnostico-ventanas.ps1
#
# Escribe en ventanas.log y va sacando por pantalla lo que encuentra.

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Vent {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static System.Collections.Generic.List<string> Visibles() {
    var r = new System.Collections.Generic.List<string>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      int len = GetWindowTextLength(h);
      if (len == 0) return true;
      var sb = new StringBuilder(len + 1);
      GetWindowText(h, sb, sb.Capacity);
      uint pid; GetWindowThreadProcessId(h, out pid);
      int ex = GetWindowLong(h, -20);
      r.Add(h.ToInt64() + "|" + pid + "|" + ex + "|" + sb.ToString());
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@

$log = Join-Path $PSScriptRoot 'ventanas.log'
"=== diagnostico arrancado $(Get-Date) ===" | Tee-Object -FilePath $log -Append
'Deja esto corriendo y usa el Droptimizer normalmente. Ctrl+C para parar.' | Tee-Object -FilePath $log -Append

$vistas = @{}
while ($true) {
  foreach ($w in [Vent]::Visibles()) {
    $p = $w.Split('|', 4)
    $hwnd = $p[0]; $procId = $p[1]; $exStyle = $p[2]; $titulo = $p[3]
    if ($vistas.ContainsKey($hwnd)) { continue }

    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.ProcessName -notmatch 'msedge|chrome|chromium|headless') { continue }
    $vistas[$hwnd] = $true

    $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    $cmd = $cim.CommandLine
    $padre = Get-Process -Id $cim.ParentProcessId -ErrorAction SilentlyContinue

    $linea = @(
      "[$(Get-Date -Format 'HH:mm:ss')] VENTANA NUEVA"
      "  titulo   : $titulo"
      "  proceso  : $($proc.ProcessName) (PID $procId), arrancado $($proc.StartTime)"
      "  padre    : $(if ($padre) { "$($padre.ProcessName) (PID $($cim.ParentProcessId))" } else { '(ya no existe)' })"
      "  headless : $(if ($cmd -like '*--headless*') { 'SI' } else { 'NO' })"
      "  perfil   : $(if ($cmd -match '--user-data-dir=([^\s""]*)') { $matches[1] } else { '(el tuyo de siempre)' })"
      "  exStyle  : 0x$([Convert]::ToString([int]$exStyle, 16))"
      "  cmdline  : $(if ($cmd) { $cmd.Substring(0, [Math]::Min(400, $cmd.Length)) } else { '(no legible)' })"
    ) -join "`n"
    $linea | Tee-Object -FilePath $log -Append
  }
  Start-Sleep -Milliseconds 700
}
