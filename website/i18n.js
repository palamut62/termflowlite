// TermFlow Lite site: English and Turkish. English lives in the HTML; this file
// holds the Turkish text and the strings main.js builds at runtime.
// Order: ?lang= in the URL, then the visitor's earlier pick, then the browser language.
(() => {
  'use strict'

  const STORE = 'tfl.lang'

  /** Strings the scripts build at runtime. */
  const EN = {
    version: 'Version {v}',
    released: 'released {d}',
    latest: 'latest release',
    stars: '{n} stars',
    openSource: 'Free',
    accept: '→ to accept'
  }

  const TR = {
    version: 'Sürüm {v}',
    released: '{d} yayınlandı',
    latest: 'son sürüm',
    stars: '{n} yıldız',
    openSource: 'Ücretsiz',
    accept: '→ ile kabul et',

    'meta.title': 'TermFlow Lite: her komutun nasıl bittiğini gösteren terminal',
    'meta.desc': 'TermFlow Lite, Windows ve Linux için hızlı ve ücretsiz bir terminal. Sekmeler, bölmeler, PowerShell, Git Bash, WSL ve Claude Code, Codex gibi kodlama ajanları; her komut geçti, kaldı ya da çalışıyor olarak işaretlenir.',
    skip: 'İçeriğe geç',
    'nav.home': 'TermFlow Lite ana sayfa',
    'nav.main': 'Ana menü',
    'nav.features': 'Özellikler',
    'nav.download': 'İndir',
    'nav.ide': 'Agent IDE',
    'nav.lang': 'Dil',

    'hero.title': 'Her komutun nasıl bittiğini gösteren terminal.',
    'hero.lede': 'TermFlow Lite; PowerShell, Git Bash, WSL ve Claude&nbsp;Code, Codex gibi kodlama ajanlarını sekmelerde ve bölmelerde çalıştırır. Her komut bir işaret alır: geçti, kaldı ya da hâlâ çalışıyor.',
    'hero.dlWin': 'Windows için indir',
    'hero.linux': 'Linux sürümleri',
    free: 'Kullanımı ücretsiz.',

    'demo.label': 'TermFlow Lite önizlemesi: npm test çalışıyor, git push başarısız oluyor ve satır içi bir öneri beliriyor',
    'demo.prompt': "src/price.js'e bir indirim kuralı ekle ve testini yaz",
    'demo.controls': 'Önizleme ayarları',
    'demo.theme': 'Tema',
    'demo.dark': 'Koyu',
    'demo.light': 'Açık',
    'demo.cursor': 'İmleç',
    'demo.plain': 'Sade',
    'demo.trail': 'İz',
    'demo.blaze': 'Alev',
    'demo.replay': 'Tekrar oynat',

    'proof.label': 'Proje bilgileri',
    'proof.license': 'ücret yok, reklam yok, kayıt yok',
    'proof.themes': '15 tema',
    'proof.palette': 've kendi paletin',
    'proof.accounts': '0 hesap',
    'proof.local': 'giriş yok, ayarlar cihazında kalır',

    'f1.title': 'Uzun bir oturumu tek bakışta oku',
    'f1.text': "Kabuk entegrasyonu PowerShell, Git Bash, bash ve zsh'teki her komutu işaretler. Yeşil çizgi geçtiğini, kırmızı kaldığını gösterir; yavaş komutlar ne kadar sürdüğünü de yazar.",
    'f1.li1': '<kbd>Ctrl</kbd> <kbd>↑</kbd> ve <kbd>Ctrl</kbd> <kbd>↓</kbd> ile uzun bir geçmişte komutlar arasında atla',
    'f1.li2': 'Bir komuta sağ tıkla; çıktısını kopyala, yeniden çalıştır ya da bir yapay zekâ ajanına hazır biçimde kopyala',
    'f1.li3': 'Arka plandaki bir sekmede 10 saniyeden uzun süren bir komut bitince bildirim gelir',
    'f1.alt': "TermFlow Lite'ta npm test 4,1 saniyede geçti, git push ise 128 çıkış koduyla kaldı olarak işaretli",

    'f2.title': 'Ajanları ve kabukları yan yana çalıştır',
    'f2.text': "Pencereyi böl, bölmeleri sürükleyip yeniden diz; Claude Code, Codex ya da OpenCode'u testlerini çalıştıran kabuğun yanında tut.",
    'f2.li1': "Her ajana kendi git worktree'sini ver, paralel oturumlar birbirinin üzerine yazmasın",
    'f2.li2': 'İşi bir ajandan ya da sağlayıcıdan diğerine bağlamı kaybetmeden devret',
    'f2.li3': 'Sekmeler canlı durumu gösterir: çalışıyor, girdi bekliyor, yeni çıktı var, bitti ya da kaldı',
    'f2.li4': 'Agent Memory son 30 günün oturumlarından her proje için kısa bir hafıza tutar; sıradaki ajan bir öncekinin kaldığı yerden devam eder',
    'f2.alt': 'Yan yana iki bölme: npm test çalıştıran PowerShell ve git diff ile git log gösteren Git Bash',

    'f8.title': 'Terminalini telefonuna taşı',
    'f8.text': "Remote Access'i aç, bir kez QR kodu okut; telefonun Tailscale üzerinden bilgisayarındaki TermFlow Lite'ı yönetsin. Bir ajan çalışırken masadan kalk, işi her yerden takip et.",
    'f8.li1': 'Her sekme satır satır canlı akar, dokununca klavye açılır. Telefon masaüstü terminalini daraltmadan aynalar; bir sekmeyi telefona sığdırmak için Fit\'e dokun',
    'f8.li2': 'Sekme aç ve kapat; herhangi bir kabuğu, ajanı, sağlayıcıyı ya da SSH bağlantısını başlat, ajan oturumlarını sürdür, kayıtlı komutları çalıştır',
    'f8.li3': 'Ayarları, profilleri, sağlayıcıları ve SSH bağlantılarını telefondan değiştir; bilgisayar hemen uygular',
    'f8.li4': 'Yalnızca Tailscale adresini dinler, yerel ağa ya da internete açılmaz. Telefon uygulamasından, ana ekrandan bile QR okutarak eşleşir; sen bağlantıyı kesene kadar eşli kalır',
    'f8.li5': 'Yalnızca terminali değil, bilgisayarın tamamını gör ve yönet: Screen sekmesi masaüstünü telefona getirir, oturum açma ekranı ve UAC pencereleri dahil. Dokunuş fareyi oynatır, telefon klavyesi yazar, telefonu yan çevirince ekranı kaplar. Bilgisayarda servis olarak çalışan bir VNC sunucusu ister; TermFlow ona bilgisayarın kendi üzerinden ulaşır, ağa hiç açmaz',
    'f8.alt': 'Eşleştirme QR kodu gösteren Ayarlar > Remote Access ve yanında aynı PowerShell sekmesini çalıştıran bir telefon',

    'f10.title': 'Bilgisayarındaki her ajan hazır',
    'f10.text': 'TermFlow Lite kurulu ajan CLI\'larını bulur ve her birini tam yetki bayrağıyla Yeni Sekme menüsüne ekler. Yenisini kurarsan kendiliğinden görünür.',
    'f10.li1': 'Claude Code, Codex, OpenCode, Gemini CLI, Qwen Code, Copilot CLI, Grok, Droid, Kimi, Pi ve daha fazlası; yalnızca kuruluysa',
    'f10.li2': 'Aynı liste Gezgin sağ tık menüsünde ve telefonunda da',
    'f10.li3': 'Hangi sekmenin seni beklediğini bil: renkli nokta, sayılı zil, görev çubuğu rozeti, bildirim ve ses; hepsi ajanın kendi hook\'larından. <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>J</kbd> ile oraya atla',
    'f10.li4': 'Uygulamayı yeniden açınca her sekme çıktısı ve Claude ya da Codex konuşmasıyla geri gelir. Claude ve Codex limitleri durum çubuğunda görünür',
    'f10.li5': "npm ile kurulu ajan CLI'ları açılışta ve günde bir kez arka planda kendini günceller; her profil sürümünü gösterir",
    'f10.li6': "Claude Code'un arka plan kabuk görevlerini ve alt ajanlarını canlı izle, her biri kendi sekmesinde: sekmedeki sayıya tıkla",
    'f10.alt': 'Kurulu ajan CLI\'larını tam yetki bayraklarıyla listeleyen Ayarlar > Profiles ve yeni bir ajan bulunduğunu söyleyen bildirim',

    'f9.title': 'Yazmak yerine konuş',
    'f9.text': "Space'i basılı tut ve konuş, bırakınca metin imlecin olduğu yere temizlenmiş olarak gelir; Enter'a basmadan önce kontrol edersin. Kısa basış hâlâ boşluktur. Uzun istekler için <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Space</kbd>'e bir kez bas ve konuş: durunca kendisi biter.",
    'f9.li1': 'Noktalama ve yazım düzelir, dolgu sözcükleri atılır, komutlar ve dosya adları senin yazacağın gibi yazılır',
    'f9.li2': "Nerede olduğunu bilir: kabuk isteminde komut, Claude Code, Codex ve OpenCode'da istek yazar",
    'f9.li3': "Türkçe ve İngilizce; seçtiğin OpenRouter modeli ve kendi anahtarınla çalışır, on saniyelik konuşmanın maliyeti yaklaşık yüzde bir sent",
    'f9.li4': "Sen açana kadar kapalıdır; Space'i basılı tutmadıkça ya da Ctrl+Shift+Space'e basmadıkça hiçbir şey kaydedilmez, Esc iptal eder",
    'f9.li5': 'Ajan sekmelerinde sonunda "gönder" dersen Enter senin yerine basılır; kendi adlarını ve terimlerini ekle, doğru yazılsın',
    'f9.alt': 'Dikte edilen bir komut PowerShell isteminde beklerken Dinliyor göstergesi ikinci bir kaydı gösteriyor',

    'f4.title': 'Daha az yaz, daha çok bul',
    'f4.text': 'Daha önce çalıştırdığın komutlar sen yazarken gri bir öneri olarak belirir. Almak için <kbd>→</kbd> tuşuna bas.',
    'f4.li1': "<code>src/app.ts:42:7</code> gibi derleyici ve test hataları VS Code, Cursor ya da Windsurf'te tam o satırda açılır",
    'f4.li2': 'Çalıştırdığın tüm komutlarda <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>H</kbd> ile ara',
    'f4.li3': "package.json script'lerini, Git ve Docker görevlerini <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>P</kbd> ile paletten çalıştır",
    'f4.li4': "Yazdığın satırdaki bir kelimeye çift tıkla ve üzerine yaz. İmleç olduğun yerde kalır; kabukta da Claude Code ya da Codex'te de. Tüm satırı silmek için üç tıkla ve Delete'e bas",
    'f4.alt': "İstemde npm t yazılı, npm test'in geri kalanı gri olarak öneriliyor",

    'f5.title': 'Araçlarının kaydettiği ekran görüntülerini gör',
    'f5.text': 'Bir ajan, test çalıştırması ya da script projene bir görsel veya video kaydettiğinde terminalin köşesinde bir önizleme kartı belirir. Bir dosyayı bırak ya da yapıştır, aynı kartı alırsın.',
    'f5.li1': 'Kartlar bilgi şeridinde küçük önizlemelere katlanır, hiçbir şey üst üste yığılmaz',
    'f5.li2': 'Birine tıklayıp tam boyutta gör ya da videoyu oynat; aç, klasöründe göster ya da yolunu ajanın için ekle',
    'f5.li3': "Video önizlemeleri doğrudan Windows'tan gelir, ffmpeg gerekmez ve hiçbir şey bilgisayarından dışarı çıkmaz",
    'f5.li4': "Ekran alıntısı ya da tarayıcıdan bir resim mi kopyaladın? Yapıştır; TermFlow onu PNG olarak kaydeder ve yolunu ekler, Claude Code ya da Codex'e hazır",
    'f5.alt': 'npm run capture iki ekran görüntüsü ve bir kayıt kaydediyor; terminalin sağ alt köşesinde önizlemeli üç kart beliriyor',

    'f6.title': 'Kendine göre ayarla',
    'f6.text': "On beş tema ve özel palet düzenleyici, Windows 11'de Mica ve Acrylic arka planlar, imleç izleri ve isteğe bağlı retro CRT ekran. Hareket hafif, tam ya da kapalı olabilir; sistemin hareketi azaltma ayarı her zaman önce gelir.",
    'f6.li1': 'WebGL ile çizim, ligatürler ve satır içi görseller (Sixel ve iTerm2)',
    'f6.li2': 'İstersen mekanik ya da yumuşak tuş sesleri ve testlerin geçince konfeti',
    'f6.li3': 'Bir profile resim ver; yazılarının arkasında noktalar, harfler ya da bloklarla, seçtiğin yoğunluk ve opaklıkta çizilsin',
    'f6.alt': 'Tarama çizgileri ve fosfor parıltısıyla yeşil Matrix temasında TermFlow Lite',

    'f7.title': 'Yılını terminalde gör',
    'f7.text': 'Wrapped komutlarını, en çok kullandığın araçları, en yoğun saatini ve serilerini sayar; Night Owl ve Commit Machine gibi rozetler dağıtır. Terminal çıktısı gibi, terminal yazı tipin ve tema renklerinle çizilir. Paylaşmak için görsel olarak kaydet.',
    'f7.note': 'Wrapped yalnızca sayaçları ve araç adlarını tutar, argümanları ya da çıktıyı asla; hiçbir şey bilgisayarından dışarı çıkmaz.',
    'f7.alt': 'ASCII terminal çıktısı olarak çizilmiş TermFlow Wrapped: komut sayıları, çubuklarla en çok kullanılan araçlar, saatlik blok grafik ve rozet listesi',

    'more.title': 'Kutudan bunlar da çıkıyor',
    'more.ssh': 'Kopan bağlantıya dayanan SSH',
    'more.sshText': "Kayıtlı sunucular kendi OpenSSH'ini kullanır. tmux ya da screen'e bağlan, derlemeler çalışmaya devam etsin.",
    'more.files': 'Dosya paneli',
    'more.filesText': "Ctrl+Shift+E bulunduğun klasörü listeler ve her cd'yi takip eder. Bir dosyaya çift tıklayıp editöründe aç.",
    'more.restore': 'Oturum geri yükleme',
    'more.restoreText': 'Sekmeler, klasörler ve bölme düzeni bir sonraki açılışta geri gelir.',
    'more.quake': 'Quake modu',
    'more.quakeText': 'Genel bir kısayolla pencereyi ekranın üstünden aşağı indir.',
    'more.broadcast': 'Toplu girdi',
    'more.broadcastText': '<kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>B</kbd> ile bir kez yaz, bölmedeki tüm panellere gitsin. Yazdığını alan paneller kırmızı çerçeveyle işaretlenir, SSH panelleri host adını gösterir.',
    'more.open': "TermFlow Lite'ta aç",
    'more.openText': 'Windows Gezgini menüsünden herhangi bir kabuğu ya da ajanı bir klasörde başlat.',
    'more.tray': 'Tepsiye kapat',
    'more.trayText': 'Pencereyi kapatmak terminalleri ve ajanları çalışır halde tutar.',
    'more.prs': "GitHub pull request'leri",
    'more.prsText': 'Bir pull request\'i mevcut gh oturumunla, herhangi bir ajanla kendi worktree\'sinde aç.',
    'more.widget': 'Widget görünümü',
    'more.widgetText': "Köşede küçük bir durum widget'ına küçült. Oturumlar çalışmaya devam eder; tek tıkla tam pencere geri gelir.",
    'more.inbox': 'Ajan gelen kutusu',
    'more.inboxText': 'Tüm sekmelerdeki onayların, araç çağrılarının, tamamlanan ve başarısız işlerin hassas bilgileri gizlenmiş zaman çizelgesi.',
    'more.startup': 'Başlangıçta aç',
    'more.startupText': 'Ayarlardan ya da telefonundan, Windows oturumu açılınca başlasın.',
    'more.updates': 'Otomatik güncellemeler',
    'more.updatesText': 'Kurulu uygulama yeni sürümleri denetler, sen onaylayınca güncellenir.',

    'dl.title': "TermFlow Lite'ı indir",
    'dl.winOs': 'Windows kurulum dosyası',
    'dl.winHint': 'Windows 10 ve 11, 64 bit',
    'dl.zipOs': 'Windows taşınabilir',
    'dl.zipHint': 'Kurulum yok, zipten çıkar ve çalıştır',
    'dl.appimageHint': 'Çoğu x64 dağıtım',
    'dl.debOs': 'Debian ve Ubuntu',
    'dl.debHint': '.deb paketi, x64',
    'dl.silent': 'Çok sayıda makineye mi kuruyorsun? Windows kurulum dosyası sessiz çalışır:',
    'dl.notes': 'Bu sürümde nelerin değiştiğini oku',
    support: 'TermFlow Lite işine yarıyor mu? Ücretsiz; bir kahve devam etmesine yardım eder.',
    coffee: 'Bana bir kahve ısmarla',

    owner: 'Ürün sahibi: Umut Çelik',
    'foot.releases': 'Tüm sürümler',
    'foot.ideReleases': 'Agent IDE sürümleri',
    'ide.kicker': 'Yeni: ayrı bir uygulama',
    'ide.title': 'TermFlow Agent IDE: kodlama ajanların için çalışma alanı',
    'ide.text': 'Aynı terminal, etrafında projelerinle. Her worktree ve içinde çalışan ajanlar tek kenar çubuğunda, değiştirdikleri kod bir tık uzakta.',
    'ide.li1': "Projeler, git worktree'leri ve ajan oturumları canlı durumlarıyla: çalışıyor, seni bekliyor, bitti. Duruma ya da pull request'e göre grupla veya panoyu aç",
    'ide.li2': 'Bir daldan, <code>#123</code> ya da pull request linkinden worktree aç ve içinde çalışacak ajanı seç',
    'ide.li3': "Diff'i incele, satırlara yorum yaz ve tüm yorumları ajana tek mesaj olarak gönder",
    'ide.li4': 'Kaynak kontrolü, pull request kontrolleri, GitHub görevleri ve worktree başına notlar. <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>I</kbd> düz terminale geçer',
    'ide.li5': "Orchestration: ajanın mekanik işleri kurulu başka bir ajana devreder (OpenCode, Codex, Grok, Claude Code, Antigravity, Gemini CLI, Qwen Code, Copilot CLI, Kimi, Droid); her biri kendi worktree'sinde çalışır, sonucu inceleyip uygular",
    'ide.li6': "Sidebar'daki proje menüsü her ajan profilini (Claude Code, Codex...) doğrudan o klasörde açar",
    'ide.dlWin': "Agent IDE'yi Windows için indir",
    'ide.dlLinux': 'Linux AppImage',
    'ide.note': "Ücretsiz; TermFlow Lite'ın yanına kurulur ve kendi ayarlarını tutar.",
    'ide.alt': 'Proje kenar çubuğu, inceleme yorumlu bir diff ve Source Control paneliyle TermFlow Agent IDE',
    'foot.license': 'Lisans'
  }

  function pick() {
    const query = new URLSearchParams(location.search).get('lang')
    if (query === 'en' || query === 'tr') return query
    try {
      const saved = localStorage.getItem(STORE)
      if (saved === 'en' || saved === 'tr') return saved
    } catch {}
    return /^tr\b/i.test(navigator.language || '') ? 'tr' : 'en'
  }

  let lang = pick()
  const htmlEn = new WeakMap()
  const attrEn = new WeakMap()

  function t(key, vars = {}) {
    const text = (lang === 'tr' ? TR[key] : EN[key]) ?? EN[key] ?? key
    return text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''))
  }

  /** Swaps the static text. Turkish comes from TR above, never from page input. */
  function apply() {
    document.documentElement.lang = lang
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      if (!htmlEn.has(el)) htmlEn.set(el, el.innerHTML)
      const tr = TR[el.dataset.i18n]
      el.innerHTML = lang === 'tr' && tr != null ? tr : htmlEn.get(el)
    })
    document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      if (!attrEn.has(el)) attrEn.set(el, {})
      const saved = attrEn.get(el)
      for (const pair of el.dataset.i18nAttr.split(';')) {
        const [attr, key] = pair.split(':').map((s) => s.trim())
        if (!(attr in saved)) saved[attr] = el.getAttribute(attr)
        const tr = TR[key]
        el.setAttribute(attr, lang === 'tr' && tr != null ? tr : saved[attr])
      }
    })
    document.querySelectorAll('[data-set-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.setLang === lang)))
  }

  function set(next) {
    if ((next !== 'en' && next !== 'tr') || next === lang) return
    lang = next
    try { localStorage.setItem(STORE, lang) } catch {}
    const url = new URL(location.href)
    if (lang === 'tr') url.searchParams.set('lang', 'tr')
    else url.searchParams.delete('lang')
    history.replaceState(null, '', url)
    apply()
    document.dispatchEvent(new CustomEvent('tfl:lang', { detail: lang }))
  }

  window.tflI18n = { get lang() { return lang }, t, set }

  apply()
  document.querySelectorAll('[data-set-lang]').forEach((b) => b.addEventListener('click', () => set(b.dataset.setLang)))
})()
