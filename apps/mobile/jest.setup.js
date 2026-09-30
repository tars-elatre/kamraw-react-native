jest.mock('react-native-safe-area-context',()=>({SafeAreaView:jest.requireActual('react-native').View,SafeAreaProvider:jest.requireActual('react-native').View,useSafeAreaInsets:()=>({top:0,right:0,bottom:0,left:0})}));
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{getItem:jest.fn(),setItem:jest.fn()}}));
