import 'reflect-metadata';
import {DataSource} from 'typeorm';
import {entities} from '../entities';
import {Initial1790772000000} from '../migrations/Initial1790772000000';
export function createDataSource(url:string,ssl=false) {return new DataSource({type:'postgres',url,ssl:ssl?{rejectUnauthorized:true}:false,entities,migrations:[Initial1790772000000],synchronize:false,logging:false,extra:{max:12,statement_timeout:15000}});}
