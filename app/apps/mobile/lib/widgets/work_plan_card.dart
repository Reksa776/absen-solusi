import 'package:material_ui/material_ui.dart';

import '../models/work_plan.dart';
import '../theme/app_theme.dart';

/// Kartu "Target Kerja Hari Ini" dengan checkbox yang bisa dicentang langsung.
class WorkPlanCard extends StatelessWidget {
  const WorkPlanCard({
    super.key,
    required this.plan,
    required this.onToggle,
    this.busyItemId,
  });

  final WorkPlan plan;
  final Future<void> Function(WorkPlanItem item, bool value) onToggle;
  final String? busyItemId;

  @override
  Widget build(BuildContext context) {
    final remote = plan.workMode == 'WFC' ? 'WFC' : 'WFH';
    return Container(
      key: const Key('home-work-plan-card'),
      padding: const EdgeInsets.fromLTRB(12, 11, 12, 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 7,
                  vertical: 2,
                ),
                decoration: BoxDecoration(
                  color: remote == 'WFC'
                      ? AppColors.yellowSoft
                      : AppColors.greenSoft,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(
                    color: remote == 'WFC'
                        ? AppColors.yellowLine
                        : AppColors.greenLine,
                  ),
                ),
                child: Text(
                  remote,
                  style: TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.w800,
                    color: remote == 'WFC'
                        ? AppColors.yellowInk
                        : AppColors.greenDark,
                  ),
                ),
              ),
              const SizedBox(width: 7),
              const Expanded(
                child: Text(
                  'Target Kerja Hari Ini',
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                  ),
                ),
              ),
              Text(
                plan.progressLabel,
                style: const TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: AppColors.greenDark,
                  fontFeatures: tabularFigures,
                ),
              ),
            ],
          ),
          if (plan.locationNote != null && plan.locationNote!.isNotEmpty) ...[
            const SizedBox(height: 3),
            Text(
              plan.locationNote!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 10.5,
                color: AppColors.muted,
              ),
            ),
          ],
          const SizedBox(height: 8),
          Container(
            height: 4,
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: AppColors.tableHead,
              borderRadius: BorderRadius.circular(999),
            ),
            child: FractionallySizedBox(
              alignment: Alignment.centerLeft,
              widthFactor: plan.itemCount == 0
                  ? 0
                  : plan.doneCount / plan.itemCount,
              child: Container(color: AppColors.green),
            ),
          ),
          const SizedBox(height: 6),
          for (final item in plan.items)
            InkWell(
              key: Key('work-plan-toggle-${item.id}'),
              borderRadius: BorderRadius.circular(8),
              onTap: busyItemId == item.id
                  ? null
                  : () => onToggle(item, !item.isCompleted),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 22,
                      height: 22,
                      child: busyItemId == item.id
                          ? const Padding(
                              padding: EdgeInsets.all(4),
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Checkbox(
                              value: item.isCompleted,
                              onChanged: busyItemId == item.id
                                  ? null
                                  : (value) => onToggle(
                                      item,
                                      value ?? !item.isCompleted,
                                    ),
                              visualDensity: VisualDensity.compact,
                              materialTapTargetSize:
                                  MaterialTapTargetSize.shrinkWrap,
                              side: const BorderSide(color: AppColors.line),
                            ),
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.only(top: 1),
                        child: Text(
                          item.title,
                          style: TextStyle(
                            fontSize: 11.5,
                            height: 1.35,
                            fontWeight: FontWeight.w600,
                            color: item.isCompleted
                                ? AppColors.muted
                                : AppColors.ink,
                            decoration: item.isCompleted
                                ? TextDecoration.lineThrough
                                : null,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
