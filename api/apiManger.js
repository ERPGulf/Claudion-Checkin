import Axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Create Axios instance without a static baseURL
const userApi = Axios.create({
  timeout: 60000,
});



export default userApi;
