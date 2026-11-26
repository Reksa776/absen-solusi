import 'dart:io';
import 'dart:typed_data';

import 'package:image_picker/image_picker.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../theme/app_theme.dart';

/// Draft rencana kerja yang dipakai form check-in maupun form pengajuan.
class WorkPlanDraft {
  WorkPlanDraft({String location = '', List<String> items = const []})
    : locationController = TextEditingController(text: location),
      itemControllers = (items.isEmpty ? [''] : items)
          .map((title) => TextEditingController(text: title))
          .toList();

  final TextEditingController locationController;
  final List<TextEditingController> itemControllers;
  Uint8List? attachmentBytes;
  String attachmentName = 'rencana.jpg';

  List<String> get titles => itemControllers
      .map((controller) => controller.text.trim())
      .where((title) => title.isNotEmpty)
      .toList(growable: false);

  void addItem() => itemControllers.add(TextEditingController());

  void removeItem(int index) {
    if (itemControllers.length <= 1) return;
    itemControllers.removeAt(index).dispose();
  }

  void dispose() {
    locationController.dispose();
    for (final controller in itemControllers) {
      controller.dispose();
    }
  }
}

/// Input lokasi kerja, to-do list harian, dan lampiran gambar rencana.
class WorkPlanEditor extends StatefulWidget {
  const WorkPlanEditor({
    super.key,
    required this.draft,
    required this.workMode,
    this.api,
    this.onChanged,
    this.enabled = true,
  });

  final WorkPlanDraft draft;
  final String workMode;

  /// Dipakai tombol "Generate To-Do dari Gambar"; tanpa client tombol disembunyikan.
  final ApiClient? api;
  final VoidCallback? onChanged;
  final bool enabled;

  @override
  State<WorkPlanEditor> createState() => _WorkPlanEditorState();
}

class _WorkPlanEditorState extends State<WorkPlanEditor> {
  static const int _maxWorkPlanItems = 30;

  final ImagePicker _picker = ImagePicker();
  bool _picking = false;
  bool _generating = false;

  Future<void> _pickAttachment() async {
    if (!widget.enabled || _picking) return;
    setState(() => _picking = true);
    try {
      final picked = await _picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1600,
        imageQuality: 82,
      );
      if (picked == null) return;
      final bytes = await picked.readAsBytes();
      if (!mounted) return;
      setState(() {
        widget.draft.attachmentBytes = bytes;
        widget.draft.attachmentName = picked.name.isEmpty
            ? 'rencana.jpg'
            : picked.name;
      });
      widget.onChanged?.call();
      if (widget.api != null) await _generateFromImage();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Gambar rencana tidak dapat dibuka.')),
      );
    } finally {
      if (mounted) setState(() => _picking = false);
    }
  }

  /// Minta server membaca gambar rencana kerja lalu isi to-do list.
  Future<void> _generateFromImage() async {
    final api = widget.api;
    final bytes = widget.draft.attachmentBytes;
    if (!widget.enabled || api == null || bytes == null || _generating) return;
    setState(() => _generating = true);
    Directory? tempDir;
    try {
      tempDir = await Directory.systemTemp.createTemp('absensi-plan-');
      final name = widget.draft.attachmentName.trim().isEmpty
          ? 'rencana.jpg'
          : widget.draft.attachmentName.trim();
      final file = File('${tempDir.path}/$name');
      await file.writeAsBytes(bytes, flush: true);
      final items = await api.extractWorkPlanFromImage(file);
      if (!mounted) return;
      final added = _mergeExtractedItems(items);
      setState(() {});
      widget.onChanged?.call();
      if (added == 0) {
        _showSnack(
          items.isEmpty
              ? 'Gambar belum memuat teks rencana kerja yang terbaca. Silakan isi to-do list manual.'
              : 'Tidak ada tugas baru yang bisa ditambahkan (sudah ada atau batas $_maxWorkPlanItems tugas tercapai).',
        );
        return;
      }
      _showSnack(
        '$added tugas berhasil dibuat dari gambar — silakan cek atau edit sebelum kirim.',
      );
    } catch (_) {
      if (!mounted) return;
      _showSnack(
        'Rencana kerja tidak dapat dibaca dari gambar. Silakan isi to-do list manual.',
      );
    } finally {
      if (tempDir != null) {
        try {
          await tempDir.delete(recursive: true);
        } catch (_) {
          // file sementara boleh tertinggal di cache sistem
        }
      }
      if (mounted) setState(() => _generating = false);
    }
  }

  /// Gabungkan hasil ekstraksi: baris kosong default diganti, item manual tetap.
  int _mergeExtractedItems(List<String> items) {
    final draft = widget.draft;
    final cleaned = <String>[];
    final seen = <String>{};
    for (final raw in items) {
      final title = raw.trim();
      if (title.isEmpty) continue;
      if (!seen.add(title.toLowerCase())) continue;
      cleaned.add(title);
    }
    if (cleaned.isEmpty) return 0;

    final hasManual = draft.itemControllers.any(
      (controller) => controller.text.trim().isNotEmpty,
    );
    var next = 0;
    if (!hasManual) {
      for (
        var index = 0;
        index < draft.itemControllers.length && next < cleaned.length;
        index++
      ) {
        draft.itemControllers[index].text = cleaned[next];
        next += 1;
      }
    }
    while (
      next < cleaned.length &&
      draft.itemControllers.length < _maxWorkPlanItems
    ) {
      draft.itemControllers.add(TextEditingController(text: cleaned[next]));
      next += 1;
    }
    return next;
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final draft = widget.draft;
    final wfc = widget.workMode == 'WFC';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 12),
        const Text(
          'Lokasi Kerja',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.2,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: 6),
        TextField(
          key: const Key('work-plan-location'),
          controller: draft.locationController,
          enabled: widget.enabled,
          maxLength: 255,
          onChanged: (_) => widget.onChanged?.call(),
          decoration: InputDecoration(
            hintText: wfc
                ? 'Nama cafe / coworking / lokasi kerja'
                : 'Rumah atau alamat kerja hari ini',
            counterText: '',
            isDense: true,
          ),
        ),
        const SizedBox(height: 14),
        Row(
          children: [
            const Expanded(
              child: Text(
                'Rencana Kerja Hari Ini (To-Do List)',
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink,
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.greenSoft,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: AppColors.greenLine),
              ),
              child: Text(
                '${draft.titles.length} tugas',
                style: const TextStyle(
                  fontSize: 9.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.greenDark,
                  fontFeatures: tabularFigures,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 2),
        const Text(
          'Tuliskan pekerjaan yang ingin diselesaikan agar approver tahu target Anda.',
          style: TextStyle(fontSize: 10.5, height: 1.35, color: AppColors.muted),
        ),
        const SizedBox(height: 8),
        for (var index = 0; index < draft.itemControllers.length; index++)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    key: Key('work-plan-item-$index'),
                    controller: draft.itemControllers[index],
                    enabled: widget.enabled,
                    maxLength: 255,
                    onChanged: (_) => widget.onChanged?.call(),
                    decoration: InputDecoration(
                      hintText: 'Contoh: Menyusun laporan penjualan mingguan',
                      counterText: '',
                      isDense: true,
                    ),
                  ),
                ),
                IconButton(
                  key: Key('work-plan-remove-$index'),
                  tooltip: 'Hapus tugas',
                  onPressed: widget.enabled && draft.itemControllers.length > 1
                      ? () {
                          setState(() => draft.removeItem(index));
                          widget.onChanged?.call();
                        }
                      : null,
                  icon: const Icon(
                    Icons.close,
                    size: 18,
                    color: AppColors.muted,
                  ),
                ),
              ],
            ),
          ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            key: const Key('work-plan-add-item'),
            onPressed: widget.enabled
                ? () {
                    setState(draft.addItem);
                    widget.onChanged?.call();
                  }
                : null,
            style: TextButton.styleFrom(
              minimumSize: const Size(0, 34),
              padding: const EdgeInsets.symmetric(horizontal: 8),
              textStyle: const TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
              ),
            ),
            icon: const Icon(Icons.add, size: 16),
            label: const Text('Tambah Tugas'),
          ),
        ),
        const SizedBox(height: 6),
        if (draft.attachmentBytes != null) ...[
          Container(
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: AppColors.canvas,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.line),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Image.memory(
                  draft.attachmentBytes!,
                  height: 120,
                  fit: BoxFit.cover,
                ),
                Row(
                  children: [
                    const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 10),
                      child: Icon(
                        Icons.image_outlined,
                        size: 14,
                        color: AppColors.muted,
                      ),
                    ),
                    const Expanded(
                      child: Text(
                        'Gambar rencana terlampir',
                        style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.muted,
                        ),
                      ),
                    ),
                    TextButton(
                      key: const Key('work-plan-remove-attachment'),
                      onPressed: widget.enabled
                          ? () {
                              setState(
                                () => draft.attachmentBytes = null,
                              );
                              widget.onChanged?.call();
                            }
                          : null,
                      child: const Text('Hapus'),
                    ),
                  ],
                ),
                if (widget.api != null) ...[
                  const Divider(height: 1, color: AppColors.line),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: OutlinedButton.icon(
                        key: const Key('work-plan-generate-from-image'),
                        onPressed: widget.enabled && !_generating
                            ? _generateFromImage
                            : null,
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(0, 36),
                          textStyle: const TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        icon: _generating
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: AppColors.greenDark,
                                ),
                              )
                            : const Icon(
                                Icons.document_scanner_outlined,
                                size: 16,
                              ),
                        label: Text(
                          _generating
                              ? 'Membaca rencana kerja dari gambar...'
                              : 'Generate To-Do dari Gambar',
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 6),
        ],
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            key: const Key('work-plan-attach'),
            onPressed: widget.enabled && !_picking ? _pickAttachment : null,
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(0, 38),
              textStyle: const TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
              ),
            ),
            icon: Icon(
              draft.attachmentBytes == null
                  ? Icons.image_outlined
                  : Icons.check_circle_outline,
              size: 16,
            ),
            label: Text(
              _picking
                  ? 'Membuka galeri…'
                  : draft.attachmentBytes == null
                  ? 'Lampirkan Gambar / Foto Plan'
                  : 'Ganti gambar rencana',
            ),
          ),
        ),
      ],
    );
  }
}
