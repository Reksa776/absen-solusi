import 'package:material_ui/material_ui.dart';

import '../api/api_client.dart';
import '../models/client_visit.dart';
import '../services/auth_service.dart';
import '../theme/app_theme.dart';

class PayslipsScreen extends StatefulWidget {
  const PayslipsScreen({super.key, required this.auth});

  final AuthService auth;

  @override
  State<PayslipsScreen> createState() => _PayslipsScreenState();
}

class _PayslipsScreenState extends State<PayslipsScreen> {
  List<Payslip> _rows = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await widget.auth.api.myPayslips();
      if (!mounted) return;
      setState(() {
        _rows = rows;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = messageForApiError(error);
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Slip gaji tidak dapat dimuat.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.canvas,
      appBar: AppBar(
        title: const Text('Slip Gaji'),
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
      ),
      body: RefreshIndicator(
        color: AppColors.green,
        onRefresh: _load,
        child: _body(),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            _error!,
            key: const Key('payslips-error'),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          const SizedBox(height: 12),
          OutlinedButton(onPressed: _load, child: const Text('Coba lagi')),
        ],
      );
    }
    if (_rows.isEmpty) {
      return ListView(
        padding: const EdgeInsets.all(24),
        children: const [
          SizedBox(height: 50),
          Icon(Icons.receipt_long_outlined, size: 38, color: AppColors.muted),
          SizedBox(height: 10),
          Text(
            'Belum ada slip gaji yang difinalkan.\nSlip muncul setelah payroll FINALIZED atau PAID.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12.5,
              height: 1.5,
              color: AppColors.muted,
            ),
          ),
        ],
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      itemCount: _rows.length,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (context, index) {
        final row = _rows[index];
        return InkWell(
          key: Key('payslip-${row.runId}'),
          borderRadius: BorderRadius.circular(14),
          onTap: () => _detail(row),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.line),
            ),
            child: Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: AppColors.greenSoft,
                    borderRadius: BorderRadius.circular(11),
                    border: Border.all(color: AppColors.greenLine),
                  ),
                  child: const Icon(
                    Icons.payments_outlined,
                    size: 20,
                    color: AppColors.greenDark,
                  ),
                ),
                const SizedBox(width: 11),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Slip gaji ${_month(row.periodMonth)} ${row.periodYear}',
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: AppColors.ink,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        row.paidAt == null
                            ? 'Sudah difinalkan'
                            : 'Dibayar ${_shortDate(row.paidAt!)}',
                        style: const TextStyle(
                          fontSize: 10.5,
                          color: AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      _money(row.item.netPay),
                      style: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w800,
                        color: AppColors.greenDark,
                        fontFeatures: tabularFigures,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: row.isPaid
                            ? AppColors.greenSoft
                            : AppColors.yellowSoft,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(
                          color: row.isPaid
                              ? AppColors.greenLine
                              : AppColors.yellowLine,
                        ),
                      ),
                      child: Text(
                        row.isPaid ? 'PAID' : 'FINALIZED',
                        style: TextStyle(
                          fontSize: 9,
                          fontWeight: FontWeight.w700,
                          color: row.isPaid
                              ? AppColors.greenDark
                              : AppColors.yellowInk,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _detail(Payslip slip) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
      ),
      builder: (sheetContext) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Slip gaji ${_month(slip.periodMonth)} ${slip.periodYear}',
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                slip.isPaid
                    ? 'Dibayar ${_shortDate(slip.paidAt ?? DateTime.now())}'
                    : 'Difinalkan, menunggu pembayaran',
                style: const TextStyle(fontSize: 11, color: AppColors.muted),
              ),
              const SizedBox(height: 14),
              _line('Gaji pokok', slip.item.baseSalary),
              _line('Tunjangan hadir', slip.item.attendanceAllowance),
              _line('Tunjangan transport', slip.item.transportAllowance),
              _line('Tunjangan makan', slip.item.mealAllowance),
              _line(
                'Lembur (${slip.item.overtimeMinutes} menit)',
                slip.item.overtimePay,
              ),
              const Divider(height: 20),
              _line('Potongan keterlambatan', -slip.item.lateDeduction),
              _line(
                'Potongan ${slip.item.spLevel ?? 'SP'}',
                -slip.item.spDeduction,
              ),
              const Divider(height: 20),
              _line('Bruto', slip.item.grossPay),
              _line('Total potongan', -slip.item.totalDeductions),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.greenSoft,
                  borderRadius: BorderRadius.circular(11),
                  border: Border.all(color: AppColors.greenLine),
                ),
                child: Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'Take home pay',
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                          color: AppColors.greenDark,
                        ),
                      ),
                    ),
                    Text(
                      _money(slip.item.netPay),
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                        color: AppColors.greenDark,
                        fontFeatures: tabularFigures,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 10),
              Text(
                'Cuti ${slip.item.leaveDays} hari • izin ${slip.item.permitDays} hari • '
                'telat ${slip.item.lateMinutes} menit (${slip.item.lateIncidents} kejadian)',
                style: const TextStyle(
                  fontSize: 10.5,
                  height: 1.4,
                  color: AppColors.muted,
                  fontFeatures: tabularFigures,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _line(String label, int value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(fontSize: 11.5, color: AppColors.muted),
            ),
          ),
          Text(
            _money(value),
            style: const TextStyle(
              fontSize: 11.5,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
              fontFeatures: tabularFigures,
            ),
          ),
        ],
      ),
    );
  }

  String _money(int value) {
    final negative = value < 0;
    final digits = value.abs().toString();
    final buffer = StringBuffer();
    for (var index = 0; index < digits.length; index++) {
      if (index > 0 && (digits.length - index) % 3 == 0) buffer.write('.');
      buffer.write(digits[index]);
    }
    return '${negative ? '-' : ''}Rp $buffer';
  }

  String _month(int value) {
    const names = [
      'Januari',
      'Februari',
      'Maret',
      'April',
      'Mei',
      'Juni',
      'Juli',
      'Agustus',
      'September',
      'Oktober',
      'November',
      'Desember',
    ];
    return value >= 1 && value <= 12 ? names[value - 1] : '$value';
  }

  String _shortDate(DateTime value) {
    final local = value.toLocal();
    return '${local.day.toString().padLeft(2, '0')}/'
        '${local.month.toString().padLeft(2, '0')}/${local.year}';
  }
}
