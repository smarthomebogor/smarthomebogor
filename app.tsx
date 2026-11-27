import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  KeyRound,
  Lock,
  MessageCircle,
  Minus,
  Plus,
  QrCode,
  Unlock,
} from 'lucide-react';
import { HeroShowcaseSlider } from './components/HeroShowcaseSlider';
import { PackageSlider } from './components/PackageSlider';
import {
  CONTROL_METHODS,
  DEMO_HOME_CODE,
  DEVICES,
  FAQ_ITEMS,
  FEATURES_LIST,
  HOME_TYPES,
  INSTALL_TECH_COST,
  ROOM_OPTIONS,
  SCENES,
  WHATSAPP_DISPLAY,
  buildWhatsAppUrl,
  formatRupiah,
  type DeviceKey,
  type PackageItem,
} from './data/smartHomeData';

export default function App() {
  // Step 1: House Profile
  const [homeType, setHomeType] = useState<string>('Rumah 2 Lantai');
  const [areaM2, setAreaM2] = useState<number>(120);
  const [bedrooms, setBedrooms] = useState<number>(3);

  // Step 2: Rooms
  const [selectedRooms, setSelectedRooms] = useState<string[]>([
    'Ruang Tamu',
    'Kamar Tidur',
    'Dapur',
  ]);

  // Step 3: Devices & Installation
  const [quantities, setQuantities] = useState<Record<DeviceKey, number>>({
    lampu: 2,
    plug: 1,
    sensor: 0,
    lock: 0,
    cctv: 0,
    speaker: 0,
  });
  const [installMode, setInstallMode] = useState<'technician' | 'diy'>('technician');

  // Step 4: Control method
  const [controlMethod, setControlMethod] = useState<string>('Lewat HP');

  // Step 5: Home Code Activation & Scenes
  const [homeCodeInput, setHomeCodeInput] = useState<string>('');
  const [connectedCode, setConnectedCode] = useState<string | null>(null);
  const [codeMessage, setCodeMessage] = useState<{
    type: 'idle' | 'error' | 'success';
    text: string;
  }>({
    type: 'idle',
    text: 'Mode demo: tampilan simulasi saja. Masukkan kode apa pun (minimal 4 karakter) untuk mencoba pilihan scene.',
  });
  const [selectedScenes, setSelectedScenes] = useState<string[]>([]);

  // Payment copy feedback
  const [copiedAccount, setCopiedAccount] = useState(false);

  // FAQ accordion state
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  const toggleRoom = (room: string) => {
    setSelectedRooms((prev) =>
      prev.includes(room) ? prev.filter((r) => r !== room) : [...prev, room]
    );
  };

  const adjustDevice = (key: DeviceKey, delta: number) => {
    setQuantities((prev) => ({
      ...prev,
      [key]: Math.max(0, Math.min(20, prev[key] + delta)),
    }));
  };

  const applyPackage = (pkg: PackageItem) => {
    setQuantities({ ...pkg.quantities });
    const target = document.getElementById('konfigurator');
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleActivateHome = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = homeCodeInput.trim().toUpperCase();
    if (cleaned.length < 4) {
      setCodeMessage({
        type: 'error',
        text: 'Kode rumah minimal 4 karakter (contoh: SHB-BOGOR1).',
      });
      return;
    }
    setConnectedCode(cleaned);
    setCodeMessage({
      type: 'success',
      text: `Mode demo: kode ${cleaned} diterima. Pilihan scene aktif sebagai simulasi, belum terhubung ke perangkat asli.`,
    });
  };

  const handleUseDemoCode = () => {
    setHomeCodeInput(DEMO_HOME_CODE);
    setConnectedCode(DEMO_HOME_CODE);
    setCodeMessage({
      type: 'success',
      text: `Mode demo: kode ${DEMO_HOME_CODE} diterima. Pilihan scene aktif sebagai simulasi, belum terhubung ke perangkat asli.`,
    });
  };

  const toggleScene = (title: string) => {
    if (!connectedCode) return;
    setSelectedScenes((prev) =>
      prev.includes(title) ? prev.filter((s) => s !== title) : [...prev, title]
    );
  };

  const handleCopyAccount = async () => {
    const accountNumber = '7216327513';
    try {
      await navigator.clipboard.writeText(accountNumber);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = accountNumber;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } catch {
        // Fallback ignored if clipboard blocked
      }
      textarea.remove();
    }
    setCopiedAccount(true);
    window.setTimeout(() => setCopiedAccount(false), 2200);
  };

  const totals = useMemo(() => {
    let unitCount = 0;
    let subtotal = 0;
    const deviceSummary: string[] = [];

    for (const device of DEVICES) {
      const qty = quantities[device.key];
      unitCount += qty;
      subtotal += qty * device.price;
      if (qty > 0) {
        deviceSummary.push(`${device.name} x${qty}`);
      }
    }

    const installCost = installMode === 'technician' ? INSTALL_TECH_COST : 0;
    const grandTotal = subtotal + installCost;

    return {
      unitCount,
      subtotal,
      installCost,
      grandTotal,
      deviceSummary,
    };
  }, [quantities, installMode]);

  // Dibaca skrip checkout. Harga TIDAK dikirim, server yang menghitung.
  (window as any).__SHB_CART__ = { items: { ...quantities }, install: installMode };

  const whatsappDesignUrl = useMemo(() => {
    const lines = [
      'Halo Smart Home Bogor! Saya ingin mengirim desain smart home saya:',
      `• Profil rumah: ${homeType}, ${areaM2} m², ${bedrooms} kamar tidur`,
      `• Ruangan: ${selectedRooms.length > 0 ? selectedRooms.join(', ') : 'Belum dipilih'}`,
      `• Kontrol utama: ${controlMethod}`,
      `• Perangkat (${totals.unitCount} unit): ${
        totals.deviceSummary.length > 0 ? totals.deviceSummary.join(', ') : 'Belum dipilih'
      }`,
      `• Pemasangan: ${installMode === 'technician' ? 'Teknisi Datang' : 'Pasang Sendiri'}`,
      `• Scene rumah: ${
        selectedScenes.length > 0 ? selectedScenes.join(', ') : 'Belum dipilih'
      }`,
      `• Estimasi total: ${formatRupiah(totals.grandTotal)}`,
      'Mohon info jadwal survey gratisnya ya.',
    ];
    return buildWhatsAppUrl(lines.join('\n'));
  }, [
    homeType,
    areaM2,
    bedrooms,
    selectedRooms,
    controlMethod,
    totals,
    installMode,
    selectedScenes,
  ]);

  const directWhatsAppUrl = buildWhatsAppUrl('Halo Smart Home Bogor!');

  return (
    <div className="min-h-screen bg-[#f4faf6] text-[#111c15]">
      {/* Sticky Top Bar (3-zone contract) */}
      <header className="sticky top-0 z-30 border-b border-[#d5eadc] bg-[#f4faf6]/92 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-8 px-4 py-3 sm:px-6">
          <a
            href="#top"
            className="inline-flex items-center gap-2.5 font-serif text-xl font-semibold tracking-tight whitespace-nowrap shrink-0 text-[#111c15] sm:text-2xl"
          >
            <img
              src="/favicon.svg"
              alt=""
              aria-hidden="true"
              className="h-8 w-8 shrink-0 rounded-lg"
            />
            <span>
              Smart Home <span className="italic text-[#15803d]">Bogor</span>
            </span>
          </a>

          <nav
            aria-label="Navigasi utama"
            className="hidden items-center gap-6 text-sm font-medium text-[#4a6153] md:flex"
          >
            <a
              href="#luas-rumah"
              className="whitespace-nowrap shrink-0 transition-colors hover:text-[#15803d]"
            >
              Profil
            </a>
            <a
              href="#konfigurator"
              className="whitespace-nowrap shrink-0 transition-colors hover:text-[#15803d]"
            >
              Perangkat
            </a>
            <a
              href="#paket"
              className="whitespace-nowrap shrink-0 transition-colors hover:text-[#15803d]"
            >
              Paket
            </a>
            <a
              href="#mode-rumah"
              className="whitespace-nowrap shrink-0 transition-colors hover:text-[#15803d]"
            >
              Scene
            </a>
            <a
              href="#bayar"
              className="whitespace-nowrap shrink-0 transition-colors hover:text-[#15803d]"
            >
              Pembayaran
            </a>
          </nav>
        </div>
      </header>

      <main id="top" className="mx-auto max-w-5xl px-4 sm:px-6">
        {/* Hero Section */}
        <section className="pt-10 pb-12 sm:pt-14 sm:pb-16">
          <div className="grid items-center gap-10 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <p className="text-xs font-semibold tracking-[0.14em] text-[#15803d] uppercase">
                Melayani JABODETABEK · Survey Gratis · Kota Bogor
              </p>
              <h1 className="mt-4 font-serif text-[2.65rem] leading-[1.03] font-semibold tracking-[-0.025em] text-[#111c15] sm:text-6xl">
                Desain Smart Home{' '}
                <em className="font-semibold italic text-[#15803d]">Impianmu</em> Sendiri.
              </h1>
              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-[#4a6153] sm:text-base">
                Pilih ruangan, perangkat, dan cara kontrolnya. Harga langsung terhitung secara
                transparan tanpa tebak-tebakan. Tim lokal Bogor siap memasang dan mendampingi
                sampai mahir.
              </p>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href="#luas-rumah"
                  className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-full bg-[#15803d] px-6 py-3 text-sm font-semibold whitespace-nowrap text-white shadow-sm transition-colors hover:bg-[#14532d]"
                >
                  <span>Mulai Desain Sekarang</span>
                  <ArrowRight className="h-4 w-4" />
                </a>
                <a
                  href="#paket"
                  className="inline-flex min-h-[46px] items-center justify-center rounded-full border border-[#111c15]/20 bg-white px-6 py-3 text-sm font-semibold whitespace-nowrap text-[#111c15] transition-colors hover:border-[#15803d] hover:text-[#15803d]"
                >
                  Lihat Paket Populer
                </a>
              </div>

              <div className="mt-8 grid grid-cols-3 gap-4 border-t border-[#d5eadc] pt-6">
                <div>
                  <p className="font-serif text-2xl font-semibold tabular-nums text-[#111c15] sm:text-3xl">
                    2 Tahun
                  </p>
                  <p className="mt-0.5 text-xs text-[#52665a]">Garansi perangkat dan instalasi</p>
                </div>
                <div>
                  <p className="font-serif text-2xl font-semibold tabular-nums text-[#111c15] sm:text-3xl">
                    Sen-Sab
                  </p>
                  <p className="mt-0.5 text-xs text-[#52665a]">Dukungan 09.00-18.00 WIB</p>
                </div>
                <div>
                  <p className="font-serif text-2xl font-semibold tabular-nums text-[#111c15] sm:text-3xl">
                    Gratis
                  </p>
                  <p className="mt-0.5 text-xs text-[#52665a]">Survey dan konsultasi awal</p>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6">
              <HeroShowcaseSlider />
            </div>
          </div>
        </section>

        {/* Step 1: Profil Rumah */}
        <section id="luas-rumah" className="border-t border-[#d5eadc] py-12">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.14em] text-[#15803d] uppercase">
              01 · Profil Rumah
            </p>
            <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-[#111c15] sm:text-4xl">
              Ceritakan rumahmu terlebih dahulu
            </h2>
            <p className="mt-2 text-sm text-[#4a6153]">
              Supaya rekomendasi perangkatnya pas dengan karakter hunianmu, bukan asal banyak.
            </p>
          </div>

          <div className="mt-7 rounded-3xl border border-[#d5eadc] bg-white p-5 sm:p-8">
            <p className="text-xs font-semibold tracking-[0.1em] text-[#4a6153] uppercase">
              Tipe Hunian
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {HOME_TYPES.map((item) => {
                const selected = homeType === item.label;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setHomeType(item.label)}
                    className={`flex min-h-[82px] flex-col justify-between rounded-2xl border p-4 text-left transition-all ${
                      selected
                        ? 'border-[#15803d] bg-[#e9f8ee] text-[#111c15]'
                        : 'border-[#dcebe1] bg-white text-[#111c15] hover:border-[#9fd4b1]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold">{item.label}</span>
                      {selected && (
                        <Check className="h-4 w-4 shrink-0 text-[#15803d]" aria-hidden="true" />
                      )}
                    </div>
                    <span className="mt-2 text-xs text-[#52665a]">{item.note}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <div className="rounded-2xl border border-[#dcebe1] bg-[#fafdfb] p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="areaRange" className="text-sm font-semibold text-[#111c15]">
                    Luas bangunan
                  </label>
                  <output
                    htmlFor="areaRange"
                    className="font-serif text-3xl font-semibold tabular-nums text-[#15803d]"
                  >
                    {areaM2} m²
                  </output>
                </div>
                <input
                  id="areaRange"
                  type="range"
                  min={36}
                  max={500}
                  value={areaM2}
                  onChange={(e) => setAreaM2(Number(e.target.value))}
                  className="smart-range mt-4 w-full"
                />
                <div className="mt-2 flex justify-between text-xs font-medium tabular-nums text-[#52665a]">
                  <span>36 m²</span>
                  <span>500 m²</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-2xl border border-[#dcebe1] bg-[#fafdfb] p-5">
                <div>
                  <p className="text-sm font-semibold text-[#111c15]">Jumlah kamar tidur</p>
                  <p className="mt-1 text-xs text-[#52665a]">Rentang 1 – 10 kamar</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setBedrooms((b) => Math.max(1, b - 1))}
                    aria-label="Kurangi kamar tidur"
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-[#cde3d4] bg-white text-[#111c15] transition-colors hover:border-[#15803d]"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-7 text-center font-serif text-2xl font-semibold tabular-nums text-[#111c15]">
                    {bedrooms}
                  </span>
                  <button
                    type="button"
                    onClick={() => setBedrooms((b) => Math.min(10, b + 1))}
                    aria-label="Tambah kamar tidur"
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-[#15803d] text-white transition-colors hover:bg-[#14532d]"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Step 2 & Step 4: Ruangan & Kontrol */}
        <section id="ruangan" className="border-t border-[#d5eadc] py-12">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <p className="text-xs font-semibold tracking-[0.14em] text-[#15803d] uppercase">
                02 · Pilih Ruangan
              </p>
              <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-[#111c15]">
                Ruangan mana yang ingin dibuat pintar?
              </h2>
              <p className="mt-2 text-sm text-[#4a6153]">
                Pilih satu atau lebih area untuk penempatan sensor, lampu, dan kamera.
              </p>

              <div className="mt-6 grid grid-cols-2 gap-3">
                {ROOM_OPTIONS.map((room) => {
                  const selected = selectedRooms.includes(room);
                  return (
                    <button
                      key={room}
                      type="button"
                      onClick={() => toggleRoom(room)}
                      className={`flex min-h-[54px] items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition-all ${
                        selected
                          ? 'border-[#15803d] bg-[#e9f8ee] text-[#111c15]'
                          : 'border-[#dcebe1] bg-white text-[#111c15] hover:border-[#9fd4b1]'
                      }`}
                    >
                      <span>{room}</span>
                      {selected && <Check className="h-4 w-4 shrink-0 text-[#15803d]" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div id="kontrol" className="lg:col-span-5">
              <p className="text-xs font-semibold tracking-[0.14em] text-[#15803d] uppercase">
                03 · Cara Kontrol
              </p>
              <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-[#111c15]">
                Tentukan cara mengendalikan rumah
              </h2>
              <p className="mt-2 text-sm text-[#4a6153]">
                Pilih metode yang paling nyaman untuk rutinitas keluargamu.
              </p>

              <div className="mt-6 grid gap-3">
                {CONTROL_METHODS.map((method) => {
                  const selected = controlMethod === method.label;
                  return (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => setControlMethod(method.label)}
                      className={`flex min-h-[64px] items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-all ${
                        selected
                          ? 'border-[#15803d] bg-[#e9f8ee] text-[#111c15]'
                          : 'border-[#dcebe1] bg-white text-[#111c15] hover:border-[#9fd4b1]'
                      }`}
                    >
                      <div>
                        <p className="text-sm font-semibold">{method.label}</p>
                        <p className="mt-0.5 text-xs text-[#52665a]">{method.note}</p>
                      </div>
                      {selected && <Check className="h-4 w-4 shrink-0 text-[#15803d]" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Step 3: Konfigurator Perangkat & Estimasi */}
        <section id="konfigurator" className="border-t border-[#d5eadc] py-12">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.14em] text-[#15803d] uppercase">
              04 · Konfigurator Perangkat
            </p>
            <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-[#111c15] sm:text-4xl">
              Atur perangkat rumahmu
            </h2>
            <p className="mt-2 text-sm text-[#4a6153]">
              Sesuaikan jumlah perangkat dan pilihan pemasangan. Estimasi harga terhitung secara
              otomatis.
            </p>
          </div>

          <div className="mt-7 grid items-start gap-8 lg:grid-cols-12">
            {/* Device Rows */}
            <div className="space-y-3 rounded-3xl border border-[#d5eadc] bg-white p-5 sm:p-6 lg:col-span-7">
              {DEVICES.map((device) => {
                const qty = quantities[device.key];
                return (
                  <div
                    key={device.key}
                    className={`flex items-center justify-between gap-4 rounded-2xl border p-4 transition-colors ${
                      qty > 0
                        ? 'border-[#15803d]/50 bg-[#f1fbf4]'
                        : 'border-[#e3efe7] bg-white'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#111c15]">{device.name}</p>
                      <p className="mt-0.5 text-xs text-[#52665a]">
                        {device.description} ·{' '}
                        <span className="font-semibold tabular-nums text-[#15803d]">
                          {formatRupiah(device.price)}
                        </span>
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => adjustDevice(device.key, -1)}
                        aria-label={`Kurangi ${device.name}`}
                        className="flex h-10 w-10 items-center justify-center rounded-full border border-[#cde3d4] bg-white text-[#111c15] transition-colors hover:border-[#15803d]"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-7 text-center text-sm font-semibold tabular-nums text-[#111c15]">
                        {qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => adjustDevice(device.key, 1)}
                        aria-label={`Tambah ${device.name}`}
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-[#15803d] text-white transition-colors hover:bg-[#14532d]"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Installation Mode */}
              <div className="pt-3">
                <p className="text-xs font-semibold tracking-[0.1em] text-[#4a6153] uppercase">
                  Metode Pemasangan
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setInstallMode('technician')}
                    className={`rounded-2xl border p-4 text-left transition-all ${
                      installMode === 'technician'
                        ? 'border-[#15803d] bg-[#e9f8ee]'
                        : 'border-[#dcebe1] bg-white hover:border-[#9fd4b1]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-[#111c15]">Teknisi Datang</span>
                      {installMode === 'technician' && (
                        <Check className="h-4 w-4 text-[#15803d]" />
                      )}
                    </div>
                    <p className="mt-1 text-xs font-medium tabular-nums text-[#52665a]">
                      Rp1.500.000 · Terima beres & setting scene
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setInstallMode('diy')}
                    className={`rounded-2xl border p-4 text-left transition-all ${
                      installMode === 'diy'
                        ? 'border-[#15803d] bg-[#e9f8ee]'
                        : 'border-[#dcebe1] bg-white hover:border-[#9fd4b1]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-[#111c15]">Pasang Sendiri</span>
                      {installMode === 'diy' && <Check className="h-4 w-4 text-[#15803d]" />}
                    </div>
                    <p className="mt-1 text-xs font-medium tabular-nums text-[#52665a]">
                      Rp0 · Perangkat & buku panduan saja
                    </p>
                  </button>
                </div>
              </div>
            </div>

            {/* Live Estimate Panel */}
            <aside
              id="ringkasan"
              className="rounded-3xl border border-[#d5eadc] bg-white p-6 lg:sticky lg:top-24 lg:col-span-5"
            >
              <p className="text-xs font-semibold tracking-[0.14em] text-[#15803d] uppercase">
                Ringkasan Estimasi
              </p>
              <h3 className="mt-1 font-serif text-2xl font-semibold text-[#111c15]">
                Desain Rumahmu
              </h3>

              <dl className="mt-5 space-y-3 border-b border-[#e3efe7] pb-5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-[#52665a]">Profil hunian</dt>
                  <dd className="text-right font-semibold tabular-nums text-[#111c15]">
                    {homeType} · {areaM2} m² · {bedrooms} kmr
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#52665a]">Ruangan</dt>
                  <dd className="text-right font-semibold text-[#111c15]">
                    {selectedRooms.length > 0 ? `${selectedRooms.length} area` : 'Belum dipilih'}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#52665a]">Kontrol utama</dt>
                  <dd className="text-right font-semibold text-[#111c15]">{controlMethod}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#52665a]">Total perangkat</dt>
                  <dd className="font-semibold tabular-nums text-[#111c15]">
                    {totals.unitCount} unit
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#52665a]">Subtotal perangkat</dt>
                  <dd className="font-semibold tabular-nums text-[#111c15]">
                    {formatRupiah(totals.subtotal)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#52665a]">Instalasi</dt>
                  <dd className="font-semibold tabular-nums text-[#111c15]">
                    {formatRupiah(totals.installCost)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#52665a]">Scene rumah ({selectedScenes.length})</dt>
                  <dd className="text-right font-semibold tabular-nums text-[#111c15]">
                    {selectedScenes.length > 0 ? selectedScenes.join(', ') : 'Belum ada'}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#52665a]">Setup scene</dt>
                  <dd className="font-semibold tabular-nums text-[#15803d]">Rp0</dd>
                </div>
              </dl>

              <div className="mt-5 rounded-2xl bg-[#10291c] p-5 text-white">
                <p className="text-[11px] font-semibold tracking-[0.16em] text-emerald-300 uppercase">
                  Estimasi Total
                </p>
                <p className="mt-1 font-serif text-4xl font-semibold tabular-nums tracking-tight text-white">
                  {formatRupiah(totals.grandTotal)}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-emerald-100/80">
                  Harga final ditentukan setelah survey gratis. Tanpa biaya tersembunyi.
                </p>
              </div>

              <a
                href={whatsappDesignUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-[#15803d] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#14532d]"
              >
                <MessageCircle className="h-4 w-4" />
                <span>Kirim Desain via WhatsApp</span>
              </a>
            </aside>
          </div>
        </section>

        {/* Step 5: Aktivasi Kode Rumah & Mode Scene */}
        <section id="hubungkan-rumah" className="border-t border-[#d5eadc] py-12">
          <div className="grid gap-8 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <p className="text-xs font-semibold tracking-[0.14em] text-[#15803d] uppercase">
                05 · Hubungkan Rumahmu
              </p>
              <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-[#111c15]">
                Masukkan kode rumahmu dulu
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[#4a6153]">
                Masukkan kode yang diberikan oleh Smart Home Bogor untuk membuka kontrol scene dan
                menyertakan mode suasana dalam estimasi desainmu.
              </p>

              <form
                onSubmit={handleActivateHome}
                className="mt-6 rounded-3xl border border-[#d5eadc] bg-white p-5 sm:p-6"
              >
                <label htmlFor="homeCode" className="block text-xs font-semibold text-[#111c15]">
                  Kode rumah
                </label>
                <div className="relative mt-2">
                  <KeyRound className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-[#52665a]" />
                  <input
                    id="homeCode"
                    type="text"
                    autoComplete="off"
                    value={homeCodeInput}
                    onChange={(e) => setHomeCodeInput(e.target.value)}
                    placeholder="Contoh: SHB-BOGOR1"
                    className="w-full rounded-2xl border border-[#cde3d4] bg-[#fafdfb] py-3.5 pr-4 pl-11 text-sm font-medium text-[#111c15] uppercase outline-none transition-colors focus:border-[#15803d]"
                  />
                </div>

                <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
                  <button
                    type="submit"
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full bg-[#15803d] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#14532d]"
                  >
                    Hubungkan Rumah
                  </button>
                  <button
                    type="button"
                    onClick={handleUseDemoCode}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-[#cde3d4] bg-white px-4 py-2.5 text-xs font-semibold text-[#15803d] transition-colors hover:border-[#15803d]"
                  >
                    Coba Kode Demo
                  </button>
                </div>

                <div
                  role="status"
                  className={`mt-4 flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                    codeMessage.type === 'success'
                      ? 'bg-[#e9f8ee] font-medium text-[#14532d]'
                      : codeMessage.type === 'error'
                        ? 'bg-amber-50 font-medium text-amber-900'
                        : 'bg-[#f4faf6] text-[#52665a]'
                  }`}
                >
                  {connectedCode ? (
                    <Unlock className="mt-0.5 h-4 w-4 shrink-0 text-[#15803d]" />
                  ) : (
                    <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#52665a]" />
                  )}
                  <span>{codeMessage.text}</span>
                </div>
              </form>
            </div>

            <div id="mode-rumah" className="lg:col-span-7">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold tracking-[0.14em] text-[#15803d] uppercase">
                    06 · Scene Rumah
                  </p>
                  <h2 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-[#111c15]">
                    Atur suasana rumahmu
                  </h2>
                </div>
                <span className="text-xs font-medium text-[#52665a]">
                  {connectedCode ? `Aktif (${connectedCode})` : 'Terkunci · butuh kode rumah'}
                </span>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {SCENES.map((scene) => {
                  const isUnlocked = Boolean(connectedCode);
                  const isChecked = selectedScenes.includes(scene.title);
                  return (
                    <article
                      key={scene.id}
                      className={`flex flex-col justify-between rounded-3xl border p-5 transition-all ${
                        isChecked
                          ? 'border-[#15803d] bg-[#e9f8ee]'
                          : isUnlocked
                            ? 'border-[#d5eadc] bg-white'
                            : 'border-[#e3efe7] bg-white/75 opacity-85'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-serif text-2xl font-semibold text-[#111c15]">
                            {scene.title}
                          </h3>
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#15803d]">
                            {isUnlocked ? (
                              <>
                                <Unlock className="h-3.5 w-3.5" />
                                <span>Aktif</span>
                              </>
                            ) : (
                              <>
                                <Lock className="h-3.5 w-3.5 text-[#52665a]" />
                                <span className="text-[#52665a]">Terkunci</span>
                              </>
                            )}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-[#4a6153]">
                          {scene.description}
                        </p>
                      </div>

                      <label
                        className={`mt-4 flex items-start gap-3 rounded-2xl border p-3.5 text-xs ${
                          isUnlocked
                            ? 'cursor-pointer border-[#cde3d4] bg-[#fafdfb]'
                            : 'cursor-not-allowed border-[#e5efe9] bg-[#f7faf8]'
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={!isUnlocked}
                          checked={isChecked}
                          onChange={() => toggleScene(scene.title)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[#15803d]"
                        />
                        <span>
                          <strong className="block font-semibold text-[#111c15]">
                            Tambahkan ke ringkasan pesanan
                          </strong>
                          <span className="mt-1 block text-[#52665a]">{scene.note}</span>
                        </span>
                      </label>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Paket Populer */}
        <section id="paket" className="border-t border-[#d5eadc] py-12">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.14em] text-[#15803d] uppercase">
              Paket Populer
            </p>
            <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-[#111c15] sm:text-4xl">
              Ingin lebih cepat? Mulai dari paket pilihan
            </h2>
            <p className="mt-2 text-sm text-[#4a6153]">
              Tekan tombol pada salah satu paket untuk langsung mengisi konfigurator sesuai
              kebutuhan.
            </p>
          </div>

          <div className="mt-7">
            <PackageSlider onSelectPackage={applyPackage} />
          </div>
        </section>

        {/* Fitur & Survey */}
        <section id="fitur" className="border-t border-[#d5eadc] py-12">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <p className="text-xs font-semibold tracking-[0.14em] text-[#15803d] uppercase">
                Fitur Utama
              </p>
              <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-[#111c15]">
                Cara kerja tiap fitur di rumahmu
              </h2>
              <div className="mt-6 divide-y divide-[#dcebe1] rounded-3xl border border-[#d5eadc] bg-white px-6">
                {FEATURES_LIST.map((item) => (
                  <div key={item.title} className="py-5">
                    <h3 className="font-serif text-xl font-semibold text-[#111c15]">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-[#4a6153]">
                      {item.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div id="survey" className="lg:col-span-6">
              <p className="text-xs font-semibold tracking-[0.14em] text-[#15803d] uppercase">
                Survey Lokasi
              </p>
              <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-[#111c15]">
                Survey Gratis untuk JABODETABEK
              </h2>
              <p className="mt-2 text-sm text-[#4a6153]">
                Jakarta, Bogor, Depok, Tangerang, Bekasi: kunjungan survey ke rumahmu gratis,
                tanpa kewajiban membeli.
              </p>

              <div className="mt-6 rounded-3xl border border-[#d5eadc] bg-white p-6">
                <ul className="space-y-3 text-sm text-[#111c15]">
                  <li className="flex items-start gap-3">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#15803d]" />
                    <span>
                      Teknisi mengecek kondisi rumah, jaringan listrik, dan titik perangkat terbaik.
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#15803d]" />
                    <span>Rekomendasi perangkat yang benar-benar efisien sesuai kebutuhan.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#15803d]" />
                    <span>Perhitungan harga final yang akurat sebelum pemasangan dimulai.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#15803d]" />
                    <span>Konsultasi langsung seputar scene, cara kontrol, dan perawatan.</span>
                  </li>
                </ul>
              </div>

              <div className="mt-4 rounded-3xl border border-[#c6e3d0] bg-[#e9f8ee] p-6">
                <h3 className="font-serif text-xl font-semibold text-[#111c15]">
                  Untuk area di luar JABODETABEK
                </h3>
                <ul className="mt-3 space-y-2 text-sm text-[#2d4737]">
                  <li>· Survey tetap tersedia dengan ongkos transportasi sesuai jarak dari Bogor.</li>
                  <li>· Estimasi biaya perjalanan diinformasikan di awal sebelum teknisi berangkat.</li>
                  <li>· Konsultasi desain awal via WhatsApp tetap gratis.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Pembayaran */}
        <section id="bayar" className="border-t border-[#d5eadc] py-12">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.14em] text-[#15803d] uppercase">
              Pembayaran
            </p>
            <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-[#111c15] sm:text-4xl">
              Metode pembayaran resmi
            </h2>
            <p className="mt-2 text-sm text-[#4a6153]">
              Bayar sesuai nominal yang disepakati setelah survey. Simpan bukti transfer, lalu
              konfirmasi melalui WhatsApp.
            </p>
          </div>

          <div className="mt-7 grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col justify-between rounded-3xl border border-[#d5eadc] bg-white p-6">
              <div>
                <p className="text-xs font-semibold tracking-[0.12em] text-[#15803d] uppercase">
                  Transfer Bank BSI
                </p>
                <div className="mt-4 rounded-2xl border border-[#dcebe1] bg-[#f4faf6] p-5">
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-[#52665a] uppercase">
                    No. Rekening
                  </p>
                  <p className="mt-1 font-serif text-3xl font-semibold tabular-nums tracking-wide text-[#111c15]">
                    7216327513
                  </p>
                  <p className="mt-1 text-sm text-[#52665a]">
                    a.n <strong className="font-semibold text-[#111c15]">dickynurjaya</strong>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopyAccount}
                className="mt-5 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-full bg-[#111c15] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1f3326]"
              >
                {copiedAccount ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-300" />
                    <span>Nomor Rekening Tersalin</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>Salin Nomor Rekening</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex flex-col items-center justify-center rounded-3xl bg-[#10291c] p-6 text-center text-white">
              <div className="flex h-full w-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/25 p-6">
                <QrCode className="h-10 w-10 text-emerald-300" strokeWidth={1.6} />
                <h3 className="mt-3 font-serif text-2xl font-semibold tracking-tight">
                  QRIS SmartHome Bogor
                </h3>
                <p className="mt-2 max-w-xs text-xs leading-relaxed text-emerald-100/80">
                  Minta kode QRIS aktif melalui WhatsApp resmi kami sebelum melakukan pembayaran
                  dengan QRIS.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="border-t border-[#d5eadc] py-12 pb-16">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.14em] text-[#15803d] uppercase">
              FAQ
            </p>
            <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-[#111c15] sm:text-4xl">
              Pertanyaan yang sering ditanyakan
            </h2>
          </div>

          <div className="mt-7 space-y-3">
            {FAQ_ITEMS.map((item, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div
                  key={item.question}
                  className="rounded-2xl border border-[#d5eadc] bg-white transition-colors"
                >
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                    className="flex min-h-[56px] w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  >
                    <span className="font-serif text-xl font-semibold text-[#111c15]">
                      {item.question}
                    </span>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f4faf6] text-[#15803d]">
                      {isOpen ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-5 text-sm leading-relaxed text-[#4a6153]">
                      {item.answer}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#d5eadc] bg-white py-10 pb-24 sm:pb-12">
        <div className="mx-auto flex max-w-5xl flex-col justify-between gap-6 px-4 text-sm text-[#52665a] sm:flex-row sm:items-end sm:px-6">
          <div>
            <div className="flex items-center gap-2.5">
              <img
                src="/favicon.svg"
                alt=""
                aria-hidden="true"
                className="h-8 w-8 shrink-0 rounded-lg"
              />
              <p className="font-serif text-2xl font-semibold text-[#111c15]">
                Smart Home <span className="italic text-[#15803d]">Bogor</span>
              </p>
            </div>
            <p className="mt-2 max-w-md">
              Rumah yang lebih aman, nyaman, dan hemat dengan cara yang gampang.
            </p>
            <p className="mt-3 text-xs">
              WhatsApp {WHATSAPP_DISPLAY} · Senin – Sabtu 09.00 – 18.00 WIB
            </p>
          </div>
          <div className="text-xs text-[#64756a] sm:text-right">
            <p>smarthomebogor.my.id · Kota Bogor, Jawa Barat</p>
            <p className="mt-1">
              © 2026 Smart Home Bogor. Harga estimasi dapat disesuaikan setelah survey gratis.
            </p>
          </div>
        </div>
      </footer>

      {/* Floating WhatsApp Button */}
      <a
        href={directWhatsAppUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat WhatsApp Smart Home Bogor"
        className="fixed right-5 bottom-5 z-20 inline-flex h-13 items-center gap-2 rounded-full bg-[#15803d] px-4 text-xs font-semibold text-white shadow-lg transition-transform hover:scale-105 hover:bg-[#14532d]"
      >
        <MessageCircle className="h-4 w-4" />
        <span>Chat WA</span>
      </a>
    </div>
  );
}
