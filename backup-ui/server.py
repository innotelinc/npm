#!/usr/bin/env python3
"""Nginx Proxy Manager settings backup UI.

Endpoints:
  GET  /                       -> management page
  GET  /api/backups            -> JSON list of backups
  GET  /download?name=...      -> download a backup archive
  POST /api/backup             -> create a new backup
  POST /api/delete             -> delete a backup archive
  POST /api/import             -> upload + validate an archive
  POST /api/import/confirm     -> restore the uploaded archive (destructive)
"""
import base64
import hmac
import json
import os
import re
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKUP_DIR = os.environ.get("BACKUP_DIR", "/backups")
BACKUP_NAME_RE = re.compile(r"^npm-backup-\d{8}-\d{6}\.tar\.gz$")

MAX_UPLOAD = 1024 * 1024 * 1024  # 1 GB

# Optional basic auth: only enforced when both vars are set
AUTH_USER = os.environ.get("BACKUP_UI_USER", "")
AUTH_PASSWORD = os.environ.get("BACKUP_UI_PASSWORD", "")
AUTH_ENABLED = bool(AUTH_USER and AUTH_PASSWORD)

CRON_SCHEDULE = os.environ.get("CRON_SCHEDULE", "").strip()
BACKUP_RETENTION = os.environ.get("BACKUP_RETENTION", "7")


def run(cmd, timeout=900):
    """Run a command, capturing combined output."""
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return p.returncode == 0, p.stdout + p.stderr


def prune_stale_pending(age=24 * 3600):
    """Remove uploaded-but-never-confirmed archives older than `age`."""
    try:
        for name in os.listdir(BACKUP_DIR):
            if not name.startswith("_pending_"):
                continue
            path = os.path.join(BACKUP_DIR, name)
            try:
                if time.time() - os.path.getmtime(path) > age:
                    os.remove(path)
            except OSError:
                pass
    except FileNotFoundError:
        pass


def list_backups():
    prune_stale_pending()
    out = []
    try:
        for name in sorted(os.listdir(BACKUP_DIR), reverse=True):
            if not BACKUP_NAME_RE.match(name):
                continue
            path = os.path.join(BACKUP_DIR, name)
            st = os.stat(path)
            out.append({
                "name": name,
                "size": st.st_size,
                "mtime": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_mtime)),
            })
    except FileNotFoundError:
        pass
    return out


def archive_entries(path):
    """Top-level and visible entries inside an archive, for validation/preview."""
    ok, out = run(["tar", "-tzf", path])
    if not ok:
        return None, out.strip()
    names = [ln for ln in out.splitlines() if ln]
    top = {n.split("/", 1)[0] for n in names if n.strip("/") != ""}
    # entries that could escape an extraction dir when restored
    unsafe = any(re.search(r"(^|/)\.\.(/|$)|^/", n) for n in names)
    sample = names[:200]
    return {"top": sorted(top), "entries": sample, "unsafe": unsafe}, None


def parse_multipart(body, content_type):
    """Minimal multipart/form-data parser for a single-file upload."""
    m = re.search(r'boundary=(?:"([^"]+)"|([^;]+))', content_type or "")
    if not m:
        return {}
    boundary = (m.group(1) or m.group(2)).strip().encode()
    fields = {}
    for part in body.split(b"--" + boundary):
        part = part.strip(b"\r\n")
        if not part or part == b"--":
            continue
        header_end = part.find(b"\r\n\r\n")
        if header_end == -1:
            continue
        headers = part[:header_end].decode("latin-1")
        content = part[header_end + 4:]
        nm = re.search(r'name="([^"]+)"', headers)
        if not nm:
            continue
        fm = re.search(r'filename="([^"]*)"', headers)
        if fm:
            fields[nm.group(1)] = {"filename": fm.group(1), "content": content}
        else:
            fields[nm.group(1)] = content.decode("utf-8", "replace").strip()
    return fields


class Handler(BaseHTTPRequestHandler):
    server_version = "NPMBackupUI/1.0"

    # ---- helpers -------------------------------------------------------

    def send_json(self, obj, status=200):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_error_json(self, msg, status=400):
        self.send_json({"ok": False, "error": msg}, status)

    def read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length > MAX_UPLOAD:
            raise ValueError("upload too large")
        return self.rfile.read(length)

    def log_message(self, fmt, *args):  # quiet access logs
        pass

    # ---- auth ----------------------------------------------------------

    def _authorized(self):
        if not AUTH_ENABLED:
            return True
        header = self.headers.get("Authorization", "")
        if header.startswith("Basic "):
            try:
                user, _, pw = base64.b64decode(header[6:]).decode("utf-8").partition(":")
            except Exception:
                user = pw = ""
            if hmac.compare_digest(user, AUTH_USER) and hmac.compare_digest(pw, AUTH_PASSWORD):
                return True
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="NPM Settings Backup"')
        self.send_header("Content-Length", "0")
        self.end_headers()
        return False

    # ---- routing -------------------------------------------------------

    def do_GET(self):
        if not self._authorized():
            return
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/":
            return self.serve_index()
        if path == "/api/backups":
            return self.send_json({"ok": True, "backups": list_backups()})
        if path == "/download":
            return self.serve_download(parse_qs(parsed.query))
        self.send_error_json("not found", 404)

    def do_POST(self):
        if not self._authorized():
            return
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            body = self.read_body()
        except ValueError as e:
            return self.send_error_json(str(e), 413)

        if path == "/api/backup":
            return self.api_backup()
        if path == "/api/delete":
            return self.api_delete(body)
        if path == "/api/import":
            return self.api_import(body, self.headers.get("Content-Type", ""))
        if path == "/api/import/confirm":
            return self.api_import_confirm(body)
        self.send_error_json("not found", 404)

    # ---- page ----------------------------------------------------------

    def serve_index(self):
        with open(os.path.join(ROOT, "index.html"), "rb") as f:
            data = f.read().decode("utf-8")
        if CRON_SCHEDULE:
            note = (f'<p class="sub" style="margin-top:6px">'
                    f'&#9201; Automatic backups: <code>{CRON_SCHEDULE}</code> · '
                    f'keeping the last <code>{BACKUP_RETENTION}</code> archives</p>')
        else:
            note = ""
        data = data.replace("<!--CRON_NOTE-->", note)
        data = data.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ---- backups -------------------------------------------------------

    def api_backup(self):
        ok, out = run(["sh", os.path.join(ROOT, "backup.sh")])
        last = [l for l in out.splitlines() if l.strip()]
        detail = last[-1] if last else ""
        if not ok:
            self.send_json({"ok": False, "output": out}, 500)
            return
        # find the created archive by name
        names = [b["name"] for b in list_backups()]
        self.send_json({"ok": True, "name": names[0] if names else None, "output": out})
        return

    def serve_download(self, query):
        name = query.get("name", [""])[0]
        if not BACKUP_NAME_RE.match(name):
            return self.send_error_json("invalid backup name")
        path = os.path.join(BACKUP_DIR, name)
        if not os.path.isfile(path):
            return self.send_error_json("backup not found", 404)
        size = os.path.getsize(path)
        self.send_response(200)
        self.send_header("Content-Type", "application/gzip")
        self.send_header("Content-Disposition", f'attachment; filename="{name}"')
        self.send_header("Content-Length", str(size))
        self.end_headers()
        with open(path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def api_delete(self, body):
        try:
            name = json.loads(body).get("name", "")
        except Exception:
            return self.send_error_json("bad request")
        if not BACKUP_NAME_RE.match(name):  # never allows pending/_ files
            return self.send_error_json("invalid backup name")
        path = os.path.join(BACKUP_DIR, name)
        if not os.path.isfile(path):
            return self.send_error_json("backup not found", 404)
        os.remove(path)
        return self.send_json({"ok": True})

    # ---- import --------------------------------------------------------

    def api_import(self, body, content_type):
        fields = parse_multipart(body, content_type)
        f = fields.get("file")
        if not f or not f.get("filename"):
            return self.send_error_json("no file uploaded")
        if not f["filename"].endswith(".tar.gz") and not f["filename"].endswith(".tgz"):
            return self.send_error_json("expected a .tar.gz archive")

        pending = f"_pending_{int(time.time())}.tar.gz"
        dest = os.path.join(BACKUP_DIR, pending)
        os.makedirs(BACKUP_DIR, exist_ok=True)
        with open(dest, "wb") as fh:
            fh.write(f["content"])

        info, err = archive_entries(dest)
        if info is None:
            os.remove(dest)
            return self.send_error_json(f"invalid archive: {err}", 400)

        top = set(info["top"])
        missing = [x for x in ("npm-db.sql.gz", "data", "letsencrypt") if x not in top]
        if missing:
            os.remove(dest)
            return self.send_error_json(
                f"not a settings backup - missing: {', '.join(missing)}", 400)
        if info.get("unsafe"):
            os.remove(dest)
            return self.send_error_json(
                "archive contains unsafe paths (../ or absolute); refusing", 400)

        return self.send_json({
            "ok": True,
            "pending": pending,
            "filename": f["filename"],
            "entries": info["entries"],
            "size": os.path.getsize(dest),
        })

    def api_import_confirm(self, body):
        try:
            pending = json.loads(body).get("pending", "")
        except Exception:
            return self.send_error_json("bad request")
        if not re.match(r"^_pending_\d+\.tar\.gz$", pending):
            return self.send_error_json("invalid pending archive")
        path = os.path.join(BACKUP_DIR, pending)
        if not os.path.isfile(path):
            return self.send_error_json("uploaded archive not found (expired?)", 404)

        ok, out = run(["sh", os.path.join(ROOT, "restore.sh"), path])
        # pending archive is consumed either way
        try:
            os.remove(path)
        except OSError:
            pass
        if ok:
            return self.send_json({"ok": True, "output": out})
        return self.send_json({"ok": False, "output": out}, 500)


if __name__ == "__main__":
    os.makedirs(BACKUP_DIR, exist_ok=True)
    prune_stale_pending()
    if AUTH_ENABLED:
        print("[server] basic auth enabled", flush=True)
    else:
        print("[server] basic auth disabled (set BACKUP_UI_USER / BACKUP_UI_PASSWORD to enable)", flush=True)
    port = int(os.environ.get("PORT", "80"))
    print(f"[server] listening on 0.0.0.0:{port}, backups in {BACKUP_DIR}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()