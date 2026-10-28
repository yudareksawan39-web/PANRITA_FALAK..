# Anyaman Semesta Interaktif — V3

Versi pengembangan web app Anyaman Semesta. Proyek ini siap dibuka dan diuji di VS Code, tetapi **belum berupa APK Android**.

## Perubahan V3
- Sampul pembuka menggunakan foto ketiga yang dikirim pengguna.
- Logo pada layar pembuka dan ikon web app menggunakan foto kedua yang dikirim pengguna.
- Beranda memakai foto panorama pertama sebagai latar bagian “Temukan matematika di balik keindahan motif”.
- Palet visual dipusatkan pada tiga warna: cokelat kayu, biru laut, dan emas.
- Mode gelap dibuat permanen.
- Materi keenam bab diperluas dengan bagian tambahan, aktivitas, pengujian geometri, dan panduan membaca sumber secara kritis.
- Galeri diperluas menjadi lebih dari 130 entri motif/tema lintas wilayah Indonesia, dari Aceh sampai Papua. Kartu galeri kini mencari foto dari Wikimedia Commons secara bertahap saat kartu terlihat di layar; bila foto tidak ditemukan, sketsa lokal tetap menjadi cadangan.
- Galeri mencantumkan tautan sumber dan atribusi foto ketika metadata tersedia. Hasil pencarian otomatis dapat tidak cocok persis dengan motif yang dicari, sehingga pengguna harus memeriksa judul, asal, dan lisensi pada halaman Wikimedia Commons atau sumber budaya terkait.
- Animasi kartu, logo, dan perpindahan halaman diperhalus; tombol navigasi dinamis menggunakan event delegation agar tombol yang dirender ulang tetap dapat ditekan.
- Permainan kuis, mencocokkan, transformasi, pengubinan, dan menyusun langkah tetap tersedia.
- Ikon aplikasi dan manifest web ditambahkan untuk memudahkan tahap pemasangan/pengemasan berikutnya.

## Menjalankan di VS Code
1. Ekstrak ZIP ke folder yang mudah ditemukan.
2. Buka folder tersebut di VS Code.
3. Jalankan `index.html` menggunakan ekstensi Live Server (disarankan), lalu pilih **Open with Live Server**.
4. Uji tombol Mulai, menu, semua halaman, pencarian galeri, materi, studio, dan tiap permainan.

## Penting tentang galeri
Katalog ini adalah **katalog awal yang luas, bukan inventaris final semua motif batik Indonesia**. Tidak ada satu daftar tunggal yang dapat menjamin seluruh variasi batik lokal, motif keluarga/perajin, dan nama daerah telah tercakup. Untuk menjaga akurasi budaya, deskripsi yang belum diverifikasi ditandai sebagai pengantar eksplorasi. Sketsa lokal bukan dokumentasi kain autentik. Saat online, aplikasi mencoba menemukan foto dari Wikimedia Commons per nama motif; jika tidak ada hasil, sketsa lokal digunakan. Foto dimuat dari web dan tidak dibundel ke ZIP. Hasil otomatis perlu diverifikasi karena pencarian bisa menemukan foto yang hanya berkaitan secara umum. Periksa atribusi dan lisensi di halaman sumber sebelum mengunduh, membundel, atau mendistribusikannya. Koneksi internet diperlukan untuk memuat foto web.

## Membuat APK
V3 ini masih proyek web. Setelah pengujian fungsi selesai, proyek dapat dibungkus menjadi APK Android memakai Capacitor atau WebView Android. Proses itu perlu konfigurasi Android, pengujian pada perangkat, dan pemeriksaan apakah gambar eksternal memerlukan internet.

## Pemeriksaan teknis yang dilakukan
- Sintaks `script.js` diperiksa dengan `node --check`.
- File ikon, gambar, manifest, dan sketsa galeri disertakan secara lokal.
- Pengujian interaksi lengkap pada perangkat Android belum dilakukan; mohon uji tombol, galeri, dan permainan melalui Live Server sebelum dibungkus menjadi APK.


### Perbaikan galeri V3.1
Semua 127 aset SVG sketsa edukatif yang dirujuk kartu katalog disertakan di `assets/gallery/`, sehingga kartu tidak lagi kosong saat dibuka offline. Sketsa ini adalah ilustrasi geometri, bukan foto kain batik autentik. Foto autentik memerlukan sumber gambar yang sesuai dan izin penggunaan.

### Pembaruan galeri dan Studio
- Setiap kartu galeri memiliki tombol **Studio** untuk mengirim motif yang dipilih ke Studio Kreasi.
- Studio dapat memutar, mencerminkan, menggeser, memperbesar/memperkecil, memberi tint warna, dan mengekspor kanvas sebagai PNG. Foto eksternal bergantung pada izin CORS dari host; jika host membatasi ekspor, gunakan sketsa lokal atau buka sumber foto.
- Foto autentik dicari secara bertahap lewat API Wikimedia Commons untuk menghindari ratusan permintaan serentak. Nama file, halaman sumber, dan lisensi ditampilkan ketika tersedia.


## Pembaruan V5
- Logo bulat di sebelah tombol menu adalah sakelar musik. Tekan sekali untuk memutar, tekan lagi untuk menghentikan dan mengulang dari awal. Audio berasal dari file yang dikirim pengguna (`assets/lagu-pengguna.mp3`).
- Materi setiap bab diperluas dengan contoh, rumus, aktivitas investigasi, dan tautan rujukan lanjutan.
- Galeri katalog memiliki 142 kartu/entri penelusuran dan tiap kartu memiliki sketsa SVG lokal sebagai cadangan jika foto daring gagal dimuat; foto Commons tetap perlu diverifikasi kecocokan motif, asal, dan lisensinya. Koneksi internet diperlukan untuk foto daring.
- Kartu permainan diberi animasi ringan dan tetap memperhatikan pengaturan reduced-motion perangkat.

## Catatan akurasi dan hak cipta
Katalog galeri merupakan katalog eksplorasi, bukan pernyataan bahwa seluruh motif batik Indonesia telah tercatat tanpa pengecualian. Sebagian istilah di daerah Sulawesi dapat merujuk pada tenun atau ragam hias, bukan selalu teknik batik. Periksa rujukan dan hak penggunaan sebelum aplikasi dipublikasikan.


## Perbaikan galeri V8
- Galeri sekarang mengantre pencarian foto untuk seluruh kartu ketika galeri dibuka, bukan hanya kartu yang terlihat pada layar.
- Maksimal tiga pencarian diproses bersamaan untuk mengurangi risiko pembatasan permintaan.
- Foto tetap diambil dari Wikimedia Commons dan membutuhkan internet; kecocokan serta lisensi harus diperiksa melalui halaman sumber. Jika foto tidak ditemukan, kartu menyatakan statusnya dan tidak memakai sketsa sebagai pengganti.
- Jalankan lewat VS Code Live Server (bukan membuka index.html langsung dengan file://).

## Catatan galeri foto V9
- Pencarian memakai kecocokan kata nama motif yang ketat.
- Foto generik tidak digunakan untuk mengisi kartu motif tertentu.
- Hasil rujukan tetap perlu diverifikasi pada halaman sumber.
- Jika tidak ada hasil yang cukup cocok, aplikasi menyatakan foto belum terverifikasi dan tidak mengarang foto pengganti.
- Jalankan melalui VS Code Live Server dan koneksi internet.


## Pencarian Google Images
Tautan “Cari di Google Images” membuka hasil pencarian berdasarkan nama motif dan wilayah. Google Images adalah mesin pencari, bukan API foto langsung; foto hasil pencarian tidak otomatis boleh disalin atau ditanamkan. Pastikan judul foto dan sumbernya cocok dengan motif sebelum digunakan.
