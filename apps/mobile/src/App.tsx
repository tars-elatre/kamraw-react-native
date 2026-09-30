import React from 'react';
import {ActivityIndicator,Text,View,Platform} from 'react-native';
import {SafeAreaProvider,SafeAreaView} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import {createStaticNavigation} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import Feather from '@expo/vector-icons/Feather';
import {SessionProvider,useSession} from './services/session';
import {color,styles} from './components/ui';
import {HomeScreen,BookingsScreen,BookScreen,BookingScreen,GalleriesScreen,GalleryScreen} from './screens/customer';
import {Welcome,ProfileScreen,SupportScreen,OnboardingScreen,AlbumScreen} from './screens/account';
import {OffersScreen,JobsScreen,JobScreen,EarningsScreen} from './screens/creator';
const tabStyle={headerStyle:{backgroundColor:color.paper},headerTintColor:color.ink,headerShadowVisible:false,tabBarActiveTintColor:color.red,tabBarInactiveTintColor:color.muted,tabBarStyle:{backgroundColor:color.white,borderTopColor:color.line},sceneStyle:{backgroundColor:color.paper}};
const icon=(name:React.ComponentProps<typeof Feather>['name'])=>({color:ink,size}:{color:string;size:number})=><Feather name={name} size={size} color={ink}/>;
const CustomerTabs=createBottomTabNavigator({screenOptions:tabStyle,screens:{Discover:{screen:HomeScreen,options:{title:'kamraw.',tabBarLabel:'Discover',tabBarIcon:icon('aperture')}},Bookings:{screen:BookingsScreen,options:{tabBarIcon:icon('calendar')}},Galleries:{screen:GalleriesScreen,options:{tabBarIcon:icon('image')}},You:{screen:ProfileScreen,options:{tabBarIcon:icon('user')}}}});
const CreatorTabs=createBottomTabNavigator({screenOptions:tabStyle,screens:{Offers:{screen:OffersScreen,options:{title:'kamraw. creator',tabBarLabel:'Offers',tabBarIcon:icon('zap')}},Shoots:{screen:JobsScreen,options:{title:'My shoots',tabBarIcon:icon('camera')}},Earnings:{screen:EarningsScreen,options:{tabBarIcon:icon('credit-card')}},You:{screen:ProfileScreen,options:{tabBarIcon:icon('user')}}}});
const screenOptions={headerStyle:{backgroundColor:color.paper},headerTintColor:color.ink,headerShadowVisible:false,contentStyle:{backgroundColor:color.paper}};
const CustomerStack=createNativeStackNavigator({screenOptions,screens:{Main:{screen:CustomerTabs,options:{headerShown:false}},Book:{screen:BookScreen,options:{title:'Plan your moment'}},Booking:{screen:BookingScreen,options:{title:'Your shoot'}},Gallery:{screen:GalleryScreen,options:{title:'Your gallery'}},Support:{screen:SupportScreen,options:{title:'Help & support'}},Onboarding:{screen:OnboardingScreen,options:{title:'Become a creator'}},Album:{screen:AlbumScreen,options:{title:'Your album'}}}});
const CreatorStack=createNativeStackNavigator({screenOptions,screens:{Main:{screen:CreatorTabs,options:{headerShown:false}},Job:{screen:JobScreen,options:{title:'Shoot brief'}},Support:{screen:SupportScreen,options:{title:'Help & support'}},Onboarding:{screen:OnboardingScreen,options:{title:'Your application'}}}});
const CustomerNavigation=createStaticNavigation(CustomerStack),CreatorNavigation=createStaticNavigation(CreatorStack);
function Content(){const {user,loading,demo}=useSession();if(loading)return <View style={[styles.page,{justifyContent:'center'}]}><ActivityIndicator color={color.red}/></View>;if(!user)return <SafeAreaView style={styles.page}><Welcome/></SafeAreaView>;return <View style={[{flex:1},Platform.OS==='web'?{width:'100%',maxWidth:560,alignSelf:'center'}:{}]}>{user.role==='creator'?<CreatorNavigation/>:<CustomerNavigation/>}{demo&&<Text style={{backgroundColor:color.ink,color:color.white,fontSize:10,textAlign:'center',padding:4}}>DEMO WORKSPACE · No real bookings or payments</Text>}</View>;}
export default function App(){return <SafeAreaProvider><SessionProvider><StatusBar style="dark"/><Content/></SessionProvider></SafeAreaProvider>;}
