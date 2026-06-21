from http import HTTPStatus
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen, Request
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time


ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "tracker.db"
SESSION_COOKIE = "cf_tracker_session"
PBKDF2_ITERATIONS = 260_000


def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS contests (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                contest_id TEXT,
                date TEXT,
                duration TEXT,
                added_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS problems (
                id TEXT PRIMARY KEY,
                contest_id TEXT NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
                problem_index TEXT,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                minutes TEXT,
                notes TEXT,
                updated_at TEXT NOT NULL
            );
            """
        )


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def hash_password(password, salt=None):
    salt_bytes = base64.b64decode(salt) if salt else os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt_bytes, PBKDF2_ITERATIONS)
    return base64.b64encode(digest).decode("ascii"), base64.b64encode(salt_bytes).decode("ascii")


def verify_password(password, stored_hash, salt):
    candidate, _ = hash_password(password, salt)
    return hmac.compare_digest(candidate, stored_hash)


def read_json_body(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    if not length:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


def codeforces_get(method):
    req = Request(f"https://codeforces.com/api/{method}", headers={"User-Agent": "CF-Tracking/1.0"})
    with urlopen(req, timeout=35) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if payload.get("status") != "OK":
        raise ValueError(payload.get("comment", "Codeforces API returned an error."))
    return payload["result"]


def parse_division(text):
    lower = " ".join(text.lower().split())
    for div in ("1", "2", "3", "4"):
        if f"div {div}" in lower or f"div. {div}" in lower or f"div{div}" in lower:
            return f"Div. {div}"
    return ""


def find_contest(round_number, division):
    contests = codeforces_get("contest.list")
    round_needle = f"codeforces round {round_number}"
    division_needle = division.lower()

    for contest in contests:
        name = contest["name"].lower().replace("#", "")
        if round_needle in name and division_needle in name:
            return contest
    return None


def fetch_contest_problems(contest_id):
    try:
        standings = codeforces_get(f"contest.standings?contestId={contest_id}")
        problems = standings.get("problems", [])
        if problems:
            return sorted(problems, key=lambda item: item.get("index", ""))
    except Exception:
        pass

    problemset = codeforces_get("problemset.problems")
    problems = [p for p in problemset.get("problems", []) if p.get("contestId") == contest_id]
    return sorted(problems, key=lambda item: item.get("index", ""))


def format_duration(seconds):
    if not seconds:
        return ""
    hours = int(seconds) // 3600
    minutes = (int(seconds) % 3600) // 60
    return f"{hours:02d}:{minutes:02d}"


def contest_date(start_time):
    if not start_time:
        return ""
    return time.strftime("%Y-%m-%d", time.gmtime(int(start_time)))


def get_cookie(headers, name):
    cookie_header = headers.get("Cookie", "")
    for chunk in cookie_header.split(";"):
        if "=" not in chunk:
            continue
        key, value = chunk.strip().split("=", 1)
        if key == name:
            return value
    return ""


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/me":
            return self.handle_me()
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/signup":
            return self.handle_signup()
        if path == "/api/login":
            return self.handle_login()
        if path == "/api/logout":
            return self.handle_logout()
        if path == "/api/contests":
            return self.handle_create_contest()
        if path == "/api/import-codeforces":
            return self.handle_import_codeforces()
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_PATCH(self):
        path = urlparse(self.path).path
        if path.startswith("/api/problems/"):
            return self.handle_update_problem(path.rsplit("/", 1)[-1])
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path.startswith("/api/contests/"):
            return self.handle_delete_contest(path.rsplit("/", 1)[-1])
        self.send_error(HTTPStatus.NOT_FOUND)

    def write_json(self, payload, status=HTTPStatus.OK, cookie=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def current_user(self):
        token = get_cookie(self.headers, SESSION_COOKIE)
        if not token:
            return None
        with connect() as conn:
            return conn.execute(
                """
                SELECT users.id, users.email
                FROM sessions
                JOIN users ON users.id = sessions.user_id
                WHERE sessions.token = ?
                """,
                (token,),
            ).fetchone()

    def require_user(self):
        user = self.current_user()
        if not user:
            self.write_json({"error": "Not signed in."}, HTTPStatus.UNAUTHORIZED)
            return None
        return user

    def user_payload(self, user):
        with connect() as conn:
            contests = conn.execute(
                "SELECT * FROM contests WHERE user_id = ? ORDER BY added_at DESC",
                (user["id"],),
            ).fetchall()
            result = []
            for contest in contests:
                problems = conn.execute(
                    "SELECT * FROM problems WHERE contest_id = ? ORDER BY problem_index",
                    (contest["id"],),
                ).fetchall()
                result.append(
                    {
                        "id": contest["id"],
                        "title": contest["title"],
                        "contestId": contest["contest_id"] or "",
                        "date": contest["date"] or "",
                        "duration": contest["duration"] or "",
                        "addedAt": contest["added_at"],
                        "problems": [
                            {
                                "id": p["id"],
                                "index": p["problem_index"] or "",
                                "name": p["name"],
                                "status": p["status"],
                                "minutes": p["minutes"] or "",
                                "notes": p["notes"] or "",
                                "updatedAt": p["updated_at"],
                            }
                            for p in problems
                        ],
                    }
                )
        return {"email": user["email"], "contests": result}

    def set_session(self, user_id):
        token = secrets.token_urlsafe(32)
        with connect() as conn:
            conn.execute(
                "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)",
                (token, user_id, now_iso()),
            )
        return f"{SESSION_COOKIE}={token}; HttpOnly; SameSite=Lax; Path=/"

    def clear_session_cookie(self):
        return f"{SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"

    def handle_signup(self):
        data = read_json_body(self)
        email = data.get("email", "").strip().lower()
        password = data.get("password", "")
        if "@" not in email or len(password) < 6:
            return self.write_json({"error": "Use a valid email and a password with at least 6 characters."}, HTTPStatus.BAD_REQUEST)

        password_hash, salt = hash_password(password)
        try:
            with connect() as conn:
                cursor = conn.execute(
                    "INSERT INTO users (email, password_hash, salt, created_at) VALUES (?, ?, ?, ?)",
                    (email, password_hash, salt, now_iso()),
                )
                user_id = cursor.lastrowid
        except sqlite3.IntegrityError:
            return self.write_json({"error": "An account already exists for this email."}, HTTPStatus.CONFLICT)

        cookie = self.set_session(user_id)
        self.write_json({"user": {"email": email, "contests": []}}, cookie=cookie)

    def handle_login(self):
        data = read_json_body(self)
        email = data.get("email", "").strip().lower()
        password = data.get("password", "")
        with connect() as conn:
            user = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if not user or not verify_password(password, user["password_hash"], user["salt"]):
            return self.write_json({"error": "Email or password does not match."}, HTTPStatus.UNAUTHORIZED)

        cookie = self.set_session(user["id"])
        self.write_json({"user": self.user_payload(user)}, cookie=cookie)

    def handle_logout(self):
        token = get_cookie(self.headers, SESSION_COOKIE)
        if token:
            with connect() as conn:
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        self.write_json({"ok": True}, cookie=self.clear_session_cookie())

    def handle_me(self):
        user = self.current_user()
        if not user:
            return self.write_json({"user": None})
        self.write_json({"user": self.user_payload(user)})

    def insert_contest(self, user_id, contest):
        with connect() as conn:
            conn.execute(
                """
                INSERT INTO contests (id, user_id, title, contest_id, date, duration, added_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    contest["id"],
                    user_id,
                    contest["title"],
                    contest.get("contestId", ""),
                    contest.get("date", ""),
                    contest.get("duration", ""),
                    contest.get("addedAt", now_iso()),
                ),
            )
            conn.executemany(
                """
                INSERT INTO problems (id, contest_id, problem_index, name, status, minutes, notes, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        problem["id"],
                        contest["id"],
                        problem.get("index", ""),
                        problem["name"],
                        problem.get("status", "not_solved"),
                        problem.get("minutes", ""),
                        problem.get("notes", ""),
                        problem.get("updatedAt", now_iso()),
                    )
                    for problem in contest["problems"]
                ],
            )

    def handle_create_contest(self):
        user = self.require_user()
        if not user:
            return
        data = read_json_body(self)
        if not data.get("title") or not data.get("problems"):
            return self.write_json({"error": "Contest title and problems are required."}, HTTPStatus.BAD_REQUEST)
        self.insert_contest(user["id"], data)
        self.write_json({"user": self.user_payload(user)}, HTTPStatus.CREATED)

    def handle_import_codeforces(self):
        user = self.require_user()
        if not user:
            return
        data = read_json_body(self)
        round_text = data.get("roundText", "").strip()
        round_number = re.search(r"\d+", round_text).group(0) if re.search(r"\d+", round_text) else ""
        division = parse_division(round_text) or data.get("division", "Div. 2")
        if not round_number:
            return self.write_json({"error": "Enter a Codeforces round number first."}, HTTPStatus.BAD_REQUEST)

        try:
            contest_info = find_contest(round_number, division)
            if not contest_info:
                return self.write_json({"error": f"No contest matched Round {round_number} ({division})."}, HTTPStatus.NOT_FOUND)
            cf_problems = fetch_contest_problems(contest_info["id"])
        except Exception as exc:
            return self.write_json({"error": f"Could not fetch from Codeforces. {exc}"}, HTTPStatus.BAD_GATEWAY)

        if not cf_problems:
            return self.write_json({"error": f"Found {contest_info['name']}, but no problems were returned."}, HTTPStatus.BAD_GATEWAY)

        contest = {
            "id": secrets.token_urlsafe(12),
            "title": contest_info["name"],
            "contestId": str(contest_info["id"]),
            "date": contest_date(contest_info.get("startTimeSeconds")),
            "duration": format_duration(contest_info.get("durationSeconds")),
            "addedAt": now_iso(),
            "problems": [
                {
                    "id": secrets.token_urlsafe(12),
                    "index": problem.get("index", ""),
                    "name": problem.get("name", ""),
                    "status": "not_solved",
                    "minutes": "",
                    "notes": ", ".join(problem.get("tags", [])),
                    "updatedAt": now_iso(),
                }
                for problem in cf_problems
            ],
        }
        self.insert_contest(user["id"], contest)
        self.write_json({"user": self.user_payload(user), "imported": contest})

    def handle_update_problem(self, problem_id):
        user = self.require_user()
        if not user:
            return
        data = read_json_body(self)
        allowed = {"status", "minutes", "notes"}
        updates = {key: value for key, value in data.items() if key in allowed}
        if not updates:
            return self.write_json({"error": "No valid problem fields were provided."}, HTTPStatus.BAD_REQUEST)

        with connect() as conn:
            problem = conn.execute(
                """
                SELECT problems.id
                FROM problems
                JOIN contests ON contests.id = problems.contest_id
                WHERE problems.id = ? AND contests.user_id = ?
                """,
                (problem_id, user["id"]),
            ).fetchone()
            if not problem:
                return self.write_json({"error": "Problem not found."}, HTTPStatus.NOT_FOUND)

            field_map = {"status": "status", "minutes": "minutes", "notes": "notes"}
            set_clause = ", ".join([f"{field_map[key]} = ?" for key in updates] + ["updated_at = ?"])
            values = list(updates.values()) + [now_iso(), problem_id]
            conn.execute(f"UPDATE problems SET {set_clause} WHERE id = ?", values)

        self.write_json({"user": self.user_payload(user)})

    def handle_delete_contest(self, contest_id):
        user = self.require_user()
        if not user:
            return
        with connect() as conn:
            conn.execute("DELETE FROM contests WHERE id = ? AND user_id = ?", (contest_id, user["id"]))
        self.write_json({"user": self.user_payload(user)})


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Serving CF Tracker at http://127.0.0.1:{port}")
    server.serve_forever()
