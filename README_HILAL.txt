PANRITA FALAK — MODUL HISAB & RUKYAT HILAL (PROTOTIPE)

Isi:
- index.html, style.css, script.js, config.js: proyek dasar yang diberikan, dipertahankan.
- hilal.css dan hilal.js: modul baru Hisab & Rukyat Hilal.
- aset logo, gerbang IAIN Parepare, dan sampul bulan sabit.

FITUR TAMBAHAN
1. Opsi baru "Hisab & Rukyat Hilal" pada navigasi dan beranda.
2. Ilustrasi globe 3D melayang dengan animasi ringan.
3. Peta bintang ilustratif dan penanda posisi Bulan.
4. Data lokasi GPS, perkiraan umur Bulan, waktu ijtimak berikutnya, azimut/ketinggian Bulan dan elongasi.
5. Pemeriksaan awal ambang tinggi 3° dan elongasi 6,4° (MABIMS).
6. Pratinjau kamera belakang, sensor orientasi jika didukung, dan penunjuk arah sederhana.
7. Pengingat berbasis notifikasi browser.

MENJALANKAN
1. Ekstrak ZIP.
2. Buka folder hasil ekstrak di VS Code.
3. Jalankan index.html melalui Live Server (localhost), lalu uji di HP.
4. Berikan izin GPS, kamera, sensor, dan notifikasi sesuai fitur yang dicoba.

CATATAN AKURASI PENTING
- Modul ini prototipe edukatif. Posisi Bulan dan perkiraan ijtimak memakai pendekatan sederhana dan belum tervalidasi terhadap ephemeris resmi; jangan gunakan untuk keputusan penetapan awal bulan atau observasi resmi.
- Peta bintang adalah ilustrasi, bukan peta langit real-time. Panah kamera bukan augmented reality (AR) presisi dan bergantung pada sensor kompas yang perlu dikalibrasi.
- Kriteria MABIMS ditampilkan sebagai pemeriksaan ambang, bukan jaminan hilal terlihat. Kondisi atmosfer, tinggi tempat, refraksi, semidiameter, elongasi yang dihitung dengan model tervalidasi, dan data hisab resmi tetap penting.
- Pengingat browser mungkin hanya berjalan ketika halaman/browser masih aktif. Pengingat Android yang andal memerlukan integrasi notifikasi native setelah proyek dibungkus sebagai APK.
- Jangan mengarahkan teleskop/binokular ke Matahari tanpa filter Matahari yang sesuai.
- Uji seluruh fungsi lama di perangkat sebelum mengganti proyek utama. Simpan cadangan proyek Anda.


PEMBARUAN VISUAL 27-10-2026
- Foto langit berbintang dari pengguna dipakai sebagai latar kartu “Mengenali hilal, memahami langit”.
- Globe memakai tekstur Bumi dari sumber NASA daring; tampilan tekstur membutuhkan koneksi internet. Animasi menggeser tekstur untuk memberi kesan rotasi, bukan simulasi astronomi presisi.
- Peta langit memiliki animasi objek putih/meteor yang jarang muncul. Peta ini tetap simulasi edukatif dan posisi Bulan belum ephemeris presisi.
- Kalender memberi tanda ☼ pada tanggal yang lolos pencarian awal. Tanda tersebut bukan kepastian astronomis; algoritme perlu divalidasi sebelum digunakan untuk penetapan waktu resmi.
