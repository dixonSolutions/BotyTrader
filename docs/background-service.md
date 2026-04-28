# Background service

BotyTrader has two runtime modes:

- `botytrader` opens the Ink TUI and starts the same orchestrator used by the bot.
- `botytrader run` starts the orchestrator without the TUI, keeping scheduled cycles alive for service managers.

The scheduler is owned by the orchestrator, not by the dashboard. The dashboard can be closed as long as the background service is running.

## Install the user service

Run the setup wizard once so `config.toml` and `.env` exist, then install the service from that same directory:

```bash
botytrader
botytrader service install
```

`service install` writes `~/.config/systemd/user/botytrader.service`, enables it, and starts it immediately. The unit records the current directory as `WorkingDirectory`, so the background bot reads the same `config.toml` and `.env` that the TUI created.

Use `--cwd` when the config lives somewhere else:

```bash
botytrader service install --cwd /path/to/botytrader-config
```

## Manage the service

```bash
botytrader service status
botytrader service logs
botytrader service restart
botytrader service stop
botytrader service uninstall
```

On Linux systems with systemd user services, the service runs while the user manager is active. To keep it running after logout or after boot before login, enable lingering for that user:

```bash
loginctl enable-linger "$USER"
```

## Safety model

The service does not bypass runtime gates. It calls the same orchestrator as the TUI, so broker credentials, autotrade, risk limits, exit monitoring, and order submission checks remain enforced in the backend path.
