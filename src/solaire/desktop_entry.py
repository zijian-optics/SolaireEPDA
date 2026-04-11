"""Desktop 打包入口：由 Nuitka 编译为独立进程，供 Tauri 以 sidecar 方式拉起。"""

from __future__ import annotations

import argparse
import socket


def _pick_ephemeral_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])
    finally:
        s.close()


def main() -> None:
    import uvicorn

    parser = argparse.ArgumentParser(description="SolEdu 本地服务")
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="监听端口；0 表示由操作系统分配空闲端口",
    )
    args = parser.parse_args()

    if args.port == 0:
        listen_port = _pick_ephemeral_port()
    else:
        listen_port = args.port

    # 首行协议：Rust 从子进程 stdout 读取，不依赖 Uvicorn 日志格式。
    print(f"SOLAIRE_LISTEN_PORT={listen_port}", flush=True)

    uvicorn.run(
        "solaire.web.app:app",
        host="127.0.0.1",
        port=listen_port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
