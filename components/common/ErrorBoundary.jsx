/* eslint-disable react/prop-types */
import React from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { SPACING } from "../../constants";
import useAppTheme from "../../hooks/useAppTheme";
import { recordNonFatalError } from "../../services/crashlytics.service";
import Card from "./Card";
import EmptyState from "./EmptyState";

function ErrorFallback({ onRetry }) {
  const { colors } = useAppTheme();

  return (
    <SafeAreaView
      style={{
        flex: 1,
        justifyContent: "center",
        padding: SPACING.lg,
        backgroundColor: colors.surfaceSecondary,
      }}
    >
      <Card>
        <EmptyState
          icon="alert-circle-outline"
          title="Something went wrong"
          description="This screen ran into a problem. Try again, or restart the app if it keeps happening."
          actionLabel="Try again"
          onActionPress={onRetry}
        />
      </Card>
    </SafeAreaView>
  );
}

/**
 * Catches render errors in the navigator, so one broken screen offers a retry
 * instead of closing the app, and reports them to Crashlytics.
 *
 * The report is this component's job: React Native hands caught errors to
 * ExceptionsManager directly, not to the global handler Crashlytics wraps, so
 * nothing else would send them. It wraps the navigator only, so the attendance
 * and notification bootstraps keep running while the fallback is up.
 */
class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    recordNonFatalError(error, { feature: "ui", action: "render" });
  }

  handleRetry = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) return <ErrorFallback onRetry={this.handleRetry} />;
    return this.props.children;
  }
}

export default ErrorBoundary;
