# Portainer over Tailscale

A Docker dashboard for the production VPS, reachable from the owner's own
devices anywhere and from nobody else. Set up on 2026-09-13.

Portainer mounts `/var/run/docker.sock`, which is **root on the production
host**: the database, every secret in `/etc/quest-esports`, and every
container. That decides the whole design. A public `docker.questesports.lk`
behind Nginx was considered and rejected: its login page would face the
internet, and a Portainer authentication bug would hand over the host.

## Topology

```text
owner's laptop / phone (Tailscale client)
  -> https://quest-vps.<tailnet>.ts.net:9443      tailnet only, Tailscale-issued cert
  -> tailscale serve on the VPS
  -> https+insecure://127.0.0.1:9443               Portainer's self-signed cert
  -> portainer container  (/var/run/docker.sock)
```

- Portainer publishes only `127.0.0.1:9443`, and `--http-disabled` turns off
  its plain-HTTP port 9000. The Edge tunnel port 8000 is not published.
- ufw is unchanged: 22, 80 and 443 only. Port 9443 is not reachable on the
  public IP.
- Tailscale HTTPS certificates are enabled on the tailnet. **Funnel is off**
  and must stay off.
- Tailscale SSH is off. Server access stays on the existing SSH keys.

Tailscale inserts a `ts-input` chain ahead of ufw that accepts all traffic
arriving on `tailscale0`. Any host service listening on `0.0.0.0` (sshd, Nginx)
is therefore also reachable from tailnet devices. That is acceptable only
because the tailnet contains the owner's devices alone. Review it before
sharing the tailnet with anyone else.

## Rules

1. Never add Portainer to `ops/docker/nginx/quest.conf` or any other vhost.
2. Never open 9443 (or 9000/8000) in ufw.
3. Never run `tailscale funnel` for this service.
4. Keep the port publication on `127.0.0.1`. `ops/tests/portainer-contract.test.sh`
   fails CI if this file or the Nginx config drifts from these rules.
5. Portainer is full control, not a read-only view. Deploys still go through
   the signed release workflow (`docs/ci-cd.md`). Stopping or recreating a
   `quest-prod-*` or `valorant-prod-*` container from the dashboard takes the
   site down, and stopping `quest-prod-postgres-1` stops every write.

## Install from scratch

Run as a sudo-capable operator on the VPS (Ubuntu 24.04, `noble`).

### 1. Tailscale

Install it from the signed Tailscale apt repository:

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list
sudo apt-get update
sudo apt-get install -y tailscale
```

Installing it does not restart Docker. `needrestart` only lists
`docker.service` as a candidate, and the containers keep running.

Join the tailnet. The command prints a login URL; the tailnet owner opens it
and clicks **Connect**. Signing in alone does not authorize the node.

```bash
sudo tailscale up --hostname=quest-vps
```

In the Tailscale admin console:

- **Machines -> quest-vps -> Disable key expiry.** Otherwise the node leaves
  the tailnet when its key expires (180 days) and the dashboard goes dark.
- Require two-factor authentication on the identity provider account behind
  the tailnet. It now gates root on production.

### 2. Portainer

```bash
sudo install -d -o root -g root -m 0755 /opt/portainer
sudo install -o root -g root -m 0644 ops/docker/portainer/compose.yaml /opt/portainer/compose.yaml
cd /opt/portainer && sudo docker compose up -d
```

Portainer locks first-run setup five minutes after it starts. Create the admin
account promptly; if the window closes, run `sudo docker compose restart`.

### 3. Publish to the tailnet

```bash
sudo tailscale serve --bg --https=9443 https+insecure://127.0.0.1:9443
tailscale serve status
```

The first run on a tailnet prints a link to enable Serve. Enable **HTTPS
certificates** and leave **Funnel** unchecked. The certificate publishes the
node's `*.ts.net` name to public Certificate Transparency logs; the name is not
reachable from the internet. `--bg` persists the configuration across reboots.

Check that the status says `(tailnet only)`, that
`https://quest-vps.<tailnet>.ts.net:9443` loads from a tailnet device, and that
`https://<public-ip>:9443` does not answer.

### 4. First login

1. **Setup token:** Portainer 2.45 requires one. It is printed at startup, and
   each restart issues a new one:
   ```bash
   sudo docker logs portainer 2>&1 | grep setup_token | tail -1
   ```
2. **Admin account:** use a long unique password.
3. **Edge Compute:** choose **Skip**. This host manages only itself.
4. **Environment:** choose **Add Environments -> Docker Standalone -> Start
   Wizard -> Socket**. Keep the default socket path and name it `quest-vps`.
   Do not choose Agent, API or Edge Agent; each needs an extra container or an
   open port.
5. If Portainer also created an environment called `local` for the same socket,
   remove it under **Environment-related -> Environments**. That only deletes
   the Portainer entry, not any container.

## Upgrade

Portainer is pinned to an exact version. Pick the new version from
`hub.docker.com/r/portainer/portainer-ce/tags` (prefer the tag that the `lts`
tag points at), update `image:` in this file, merge, then:

```bash
sudo install -o root -g root -m 0644 ops/docker/portainer/compose.yaml /opt/portainer/compose.yaml
cd /opt/portainer && sudo docker compose pull && sudo docker compose up -d
```

The `portainer_data` volume keeps users and settings across upgrades.

The release controller's image prune only touches the four Quest release
repositories, so it never removes the Portainer image.

## Remove

```bash
sudo tailscale serve --https=9443 off
cd /opt/portainer && sudo docker compose down        # add -v to delete users/settings
```

To take the host off the tailnet entirely, run `sudo tailscale down`, then
`sudo apt-get remove tailscale`, and delete the machine in the admin console.
