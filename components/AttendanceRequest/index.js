// PickerField and UploadField moved to components/common/ once Expense Claims
// started reusing them — they are no longer this screen's private components.
// Re-exported from here so the modern Attendance Request screen's own imports
// are unchanged.
import PickerField, {
  FIELD_CHROME_WIDTH,
  FIELD_HEIGHT,
  MIN_VALUE_WIDTH,
  fitsTwoColumns,
} from '../common/PickerField';
import UploadField from '../common/UploadField';
import ReasonOption from './ReasonOption';

export {
  // Modern UI only. The classic screen keeps using components/attachment/
  // and expo-checkbox directly.
  PickerField,
  FIELD_CHROME_WIDTH,
  FIELD_HEIGHT,
  MIN_VALUE_WIDTH,
  fitsTwoColumns,
  ReasonOption,
  UploadField,
};
