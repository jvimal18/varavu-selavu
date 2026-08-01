# rclone setup — Google Drive backups (one-time)

The budget tracker pushes a nightly JSON export to Google Drive via
[rclone](https://rclone.org/). This is a **one-time interactive** step — the
OAuth flow needs a browser — so it is not part of `setup-pi.sh`.

## 1. Install rclone (dev machine)

```bash
# Linux Mint / Debian / Raspberry Pi OS
sudo apt install rclone
# macOS
brew install rclone
```

## 2. Create the remote (interactive)

```bash
rclone config
```

Follow the prompts:

- **n** → new remote
- **name** → `gdrive`
- **Storage type** → `drive` (Google Drive)
- Leave **client_id** / **client_secret** empty (use rclone's built-in)
- Leave **scope** at the default (`drive`)
- Leave **root_folder_id** empty
- **service_account_file** → empty
- **Edit advanced config?** → `n`
- **Auto config?** → `y` — this opens a browser; sign in with the Google
  account that owns the backups
- Confirm, then **q** to quit

## 3. Verify

```bash
rclone lsd gdrive:
```

Should list the top-level folders of your Drive.

## 4. Create the backup folder

```bash
rclone mkdir gdrive:budget-tracker-backups
```

## 5. Test push

```bash
echo '{"test": true}' > /tmp/sample.json
rclone copy /tmp/sample.json gdrive:budget-tracker-backups/
rclone lsl gdrive:budget-tracker-backups/     # sample.json visible
rclone delete gdrive:budget-tracker-backups/sample.json
rm /tmp/sample.json
```

## 6. Back up the config file

The config lives at `~/.config/rclone/rclone.conf`. It contains the Drive
OAuth token — **treat it like a password**. Back it up securely (e.g. into
your password manager or an encrypted archive). Losing it means re-running the
OAuth flow.

## 7. Put the same config on the Pi

`budget` is a system user with **no home directory**, so rclone cannot find a
default config. Deploy the config into the app dir and tell rclone where it is
(the export systemd service already sets `RCLONE_CONFIG` for you):

```bash
scp ~/.config/rclone/rclone.conf vimal@192.168.0.224:~/
ssh vimal@192.168.0.224 "sudo mv ~/rclone.conf /var/lib/budget-tracker/rclone.conf && sudo chown budget:budget /var/lib/budget-tracker/rclone.conf"
```

Alternatively, re-run `rclone config` interactively on the Pi (signs in with
the same Google account) and copy the generated file to the same path.

## 8. Sanity-check on the Pi

```bash
ssh vimal@192.168.0.224 "sudo -u budget RCLONE_CONFIG=/var/lib/budget-tracker/rclone.conf rclone lsd gdrive:"
```

Should list the same top-level folders.
