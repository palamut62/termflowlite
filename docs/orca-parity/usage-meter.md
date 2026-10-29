# usage-meter - Claude ve Codex limit takibi

Durum: UYGULANDI 2026-10-14 (dal `feature/agent-hooks`). Bagimli: agent-hooks (betik altyapisi). Ortak kurallar: [README.md](README.md).

## Amac
CLI ajan kullanicisi limite takilmadan once gorsun: 5 saatlik ve haftalik pencere yuzdesi, sifirlanma
saati, %80'i gecince uyari. Durum cubugunda ajan sekmesi aktifken gorunur.

## Dogrulanmis kaynaklar (2026-10-14)
- **Codex:** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` icindeki `token_count` olaylari
  `rate_limits.primary` (`window_minutes: 300`) ve `secondary` (`10080`) icin `used_percent` + `resets_at`
  (epoch sn) ve `credits` tasiyor (bu PC'deki dosyada dogrulandi). Ag yok, token yok.
- **Claude Code:** status line betiginin stdin JSON'u `rate_limits.five_hour` / `seven_day`
  (`used_percentage`, `resets_at`) ve gateway arkasinda `spend_limit` tasir. Yalniz Pro/Max'ta ve oturumdaki
  ilk API cevabindan sonra gelir; pencereler tek tek eksik olabilir.

## Verilen kararlar (oneri)
- **Token okunmaz, saglayici API'sine istek atilmaz.** Yalniz yerel dosyalar ve ajanin kendi verdigi JSON.
- **Codex:** ana surec en yeni rollout dosyasinin sonundan son `rate_limits`'i okur (dosya izleme, 30 sn
  yoklama yedegi; dosyanin yalniz son 64 KB'i okunur). Mevcut `agentSessions.ts` / memory `sources` yol bulucusu kullanilir.
- **Claude:** TermFlow'un baslattigi Claude sekmelerinde `--settings` ile `statusLine` bir sarmalayiciya verilir
  (`out/hooks/statusline.cjs`): stdin'i okur, `rate_limits`'i `userData/agent-hooks/usage/claude.json`'a atomik
  yazar, sonra kullanicinin kendi status line komutu varsa (`~/.claude/settings.json`, proje `.claude/settings.json`
  ve `.claude/settings.local.json` okunarak; yerel > proje > kullanici) ayni stdin ile onu calistirip ciktisini
  aynen basar; yoksa bos cikti. Kullanicinin gorunumu degismez.
- Durum cubugu: aktif sekmenin ajani icin `5h 23% · 7d 41%` + sifirlanmaya kalan sure (tooltip'te saat).
  %80 ustu amber, %95 ustu kirmizi. Tiklayinca popover: tum ajanlar, pencere basina cubuk, en sikisik ust sirada,
  "Last updated" ve veri yoksa nedeni ("Pro/Max only", "No session yet").
- Ayarlar > Appearance: `usageDisplay: 'off' | 'used' | 'remaining'` (varsayilan `used`).
- Remote Access hello/settings mesajina usage ozeti eklenir (telefonda okunur).

## Basari olcutleri
- Codex sekmesi aktifken durum cubugundaki yuzde rollout dosyasindaki son degerle ayni.
- Claude Max hesabinda bir tur sonra 5h/7d gorunur; kullanicinin ozel status line'i Claude icinde aynen gorunur.
- `resets_at` gecmis pencere gosterilmez.
- Ozellik kapaliyken `--settings`'te `statusLine` yok, dosya izlenmez.

## Test
- Birim: rollout satiri ayristirma (eksik/bozuk alanlar), Claude `rate_limits` ayristirma (pencereler eksik),
  "en sikisik pencere" siralamasi, renk esikleri, kullanici statusLine cozumleme sirasi.
- Entegrasyon: statusline sarmalayicisi sahte kullanici komutunun ciktisini aynen geciriyor, JSON'u yaziyor.
- E2E: sahte rollout dosyasi (izole HOME) -> durum cubugu metni.

## Dilimler
1. Codex okuyucu + durum cubugu segmenti + popover.
2. Claude statusline sarmalayicisi + kullanici komutunu iletme.
3. Ayar, esik renkleri, telefon ozeti.

## Uygulama notlari (2026-10-14)
- Kod: `src/shared/usage.ts` (ayristirma, esikler, sure; testli), `src/main/usage/agentUsage.ts` (Codex en yeni rollout'un son
  64 KB'i, Claude kayitli JSON), hook sunucusunda `/claude-status`, `src/main/agentHooks/claudeStatusLine.ts`, renderer
  `usage/UsageMeter.tsx`. E2E `e2e/usage-meter.spec.ts` (sahte HOME + sahte codex).
- Claude yardimcisi Electron-as-node DEGIL (her guncellemede ~450 ms): `curl` (Windows'ta Git Bash icinden `curl.exe`) JSON'u
  yerel hook sunucusuna gonderir. Kullanicinin kendi status line komutu varsa (yerel > proje > kullanici) POSIX sh ile
  sarmalanir: `i=$(cat); (printf '%s' "$i" | curl ... &); printf '%s' "$i" | <kullanici komutu>`; gorunum degismez
  (bu PC'de `python ~/.claude/statusline.py` ile canli denendi). Komut basina ayar dosyasi `claude-settings-usage-<hash>.json`.
- Claude limitleri ISTEGE BAGLI (`claudeUsage`, varsayilan kapali): kullanicinin status line'i yoksa Claude alt bilgi ipuclarini
  ('esc to interrupt') gizler. Codex varsayilan acik (`usageDisplay`).
- Sunucu Claude JSON'undan yalniz `rate_limits`'i saklar (`userData/agent-hooks/usage/claude.json`); model, yol, maliyet atilir.
- Durum cubugu zemini renkli oldugu icin %80+/%95+ uyarisi metin rengi degil zemin rengi (okunurluk).
- Telefona usage ozeti eklenmedi (remote-attention'a birakildi).
- Sinir: Git Bash'siz Windows'ta (Claude PowerShell'e duser) `$TERMFLOW_HOOK_TOKEN` okunmaz, Claude limitleri gelmez.
