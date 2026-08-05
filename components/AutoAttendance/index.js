// StatusBadge moved to components/common/ once Expense Claims started using it
// for claim status — a tone-driven pill is not specific to geofencing. Re-exported
// here so the modern Automatic Attendance screen's own imports are unchanged.
import StatusBadge from '../common/StatusBadge';
import CollapsibleCard from './CollapsibleCard';
import PolicyOption from './PolicyOption';
import CoordinateField from './CoordinateField';
import EventLogItem from './EventLogItem';

export {
  // Modern UI only. The classic screen keeps its own inline InfoRow/InputRow/
  // SectionCard/PresenceCard/DevPolicyRow.
  StatusBadge,
  CollapsibleCard,
  PolicyOption,
  CoordinateField,
  EventLogItem,
};
