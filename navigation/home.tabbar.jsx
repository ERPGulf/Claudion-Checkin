import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import Ionicons from "react-native-vector-icons/Ionicons";
import { Chat, Home, Profile } from "../screens";
import { LinearGradient } from "expo-linear-gradient";
import { Dimensions } from "react-native";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
const TabStack = createBottomTabNavigator();
const { width } = Dimensions.get("window");
function HomeTabGroup() {
  const insets = useSafeAreaInsets();

  return (
    <TabStack.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: true,

        // LABEL
        tabBarLabelStyle: {
          fontSize: 12,
          marginBottom: 4,
        },

        // ICON
        tabBarIcon: ({ color, focused }) => {
          let iconName;

          if (route.name === "Home") {
            iconName = focused ? "home" : "home-outline";
          } else if (route.name === "Chat") {
            iconName = focused ? "chatbubble" : "chatbubble-outline";
          } else if (route.name === "Profile") {
            iconName = focused ? "person" : "person-outline";
          }

          return (
            <View
              style={{
                width: 40,
                height: 40,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Ionicons name={iconName} size={22} color={color} />
            </View>
          );
        },

        // COLORS
        tabBarActiveTintColor: "#FFF",
        tabBarInactiveTintColor: "#F3C1C1",

        // STYLE
        tabBarStyle: {
          position: "absolute",
          flexDirection: "row",
          justifyContent: "center",
          bottom: 0,
          width: "100%",

          height: 70 + insets.bottom, 
          paddingBottom: insets.bottom, 

          borderRadius: 8,
          overflow: "hidden",
          paddingHorizontal: 0,

          shadowColor: "#000",
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.08,
          shadowRadius: 8,
          elevation: 10,
        },
        tabBarItemStyle: {
          width: 40,
          height: 40,
          marginHorizontal: 21,
        },
        // GRADIENT
        tabBarBackground: () => (
          <LinearGradient
            colors={["#77224C", "#8E273B"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ flex: 1 }}
          />
        ),
      })}
    >
      <TabStack.Screen name="Home" component={Home} />
      <TabStack.Screen name="Chat" component={Chat} />
      <TabStack.Screen name="Profile" component={Profile} />
    </TabStack.Navigator>
  );
}

export default HomeTabGroup;
