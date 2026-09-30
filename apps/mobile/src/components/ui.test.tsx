import React,{useState} from 'react';
import {render,screen,userEvent} from '@testing-library/react-native';
import {Button,ErrorNotice,Field} from './ui';
import {Text,View} from 'react-native';
jest.useFakeTimers();
test('busy payment action cannot be submitted twice',async()=>{const action=jest.fn();await render(<Button title="Confirm booking" onPress={action} busy/>);expect(screen.getByRole('button',{name:'Confirm booking'})).toBeDisabled();await userEvent.press(screen.getByRole('button',{name:'Confirm booking'}));expect(action).not.toHaveBeenCalled();});
test('validation errors are exposed as alerts',async()=>{await render(<ErrorNotice message="Choose a serviceable venue"/>);expect(screen.getByRole('alert')).toHaveTextContent('Choose a serviceable venue');});
function Form(){const [name,setName]=useState(''),[saved,setSaved]=useState(false);return <View><Field label="Your name" value={name} onChangeText={setName}/><Button title="Save profile" disabled={name.trim().length<2} onPress={()=>setSaved(true)}/>{saved&&<Text>Saved {name}</Text>}</View>;}
test('accessible form enables saving after a valid entry',async()=>{const user=userEvent.setup();await render(<Form/>);expect(screen.getByRole('button',{name:'Save profile'})).toBeDisabled();await user.type(screen.getByLabelText('Your name'),'Meena');await user.press(screen.getByRole('button',{name:'Save profile'}));expect(screen.getByText('Saved Meena')).toBeOnTheScreen();});
