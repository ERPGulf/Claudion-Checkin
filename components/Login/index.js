import WelcomeCard from './WelcomeCard';
import GreetingCard from './GreetingCard';

// <WelcomeCard> is the classic screen's hero and is kept only for it;
// <GreetingCard> is the modern replacement. Both are exported so the two UIs can
// be swapped by the "Enable Modern UI" toggle without either importing the other.
export { WelcomeCard, GreetingCard };
