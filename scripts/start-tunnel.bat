@echo off
echo Starting Cloudflare Tunnel...
cloudflared tunnel --config .cloudflared\config.yml run
pause
