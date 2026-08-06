// Classic UI. Rendered only by ExpenseClaimLegacy.
import ClaimForm from './ClaimForm';
import ExpenseCard from './ExpenseCard';
// Modern UI only. The classic screen keeps using @react-native-picker/picker,
// its own gray-50 TextInputs, its own attachment button and its own "Load More".
// Lives in components/common/ now — Leave Application uses it too.
// Re-exported here so existing imports keep working.
import FormField from '../common/FormField';
import ExpenseTypeSheet from './ExpenseTypeSheet';
import ClaimFormSection from './ClaimFormSection';
import ExpenseHistoryCard from './ExpenseHistoryCard';
import ExpenseSkeleton from './ExpenseSkeleton';
import HistoryFooter from './HistoryFooter';
import HistorySectionHeader from './HistorySectionHeader';
import AppearingItem from './AppearingItem';

export {
  ClaimForm,
  ExpenseCard,
  FormField,
  ExpenseTypeSheet,
  ClaimFormSection,
  ExpenseHistoryCard,
  ExpenseSkeleton,
  HistoryFooter,
  HistorySectionHeader,
  AppearingItem,
};
