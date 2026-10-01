import 'reflect-metadata';
import {DataSource} from 'typeorm';
import {entities} from '../entities';
import {CreatorFeedback1790797000000} from '../migrations/CreatorFeedback1790797000000';
import {Initial1790772000000} from '../migrations/Initial1790772000000';
import {CreditWallet1790796000000} from '../migrations/CreditWallet1790796000000';
import {ServiceReminders1790795000000} from '../migrations/ServiceReminders1790795000000';
import {Retention1790794000000} from '../migrations/Retention1790794000000';
import {PrintFulfilment1790793000000} from '../migrations/PrintFulfilment1790793000000';
import {Recovery1790792000000} from '../migrations/Recovery1790792000000';
import {Notifications1790791000000} from '../migrations/Notifications1790791000000';
import {SessionChanges1790790000000} from '../migrations/SessionChanges1790790000000';
export function createDataSource(url:string,ssl=false) {return new DataSource({type:'postgres',url,ssl:ssl?{rejectUnauthorized:true}:false,entities,migrations:[Initial1790772000000,SessionChanges1790790000000,Notifications1790791000000,Recovery1790792000000,PrintFulfilment1790793000000,Retention1790794000000,ServiceReminders1790795000000,CreditWallet1790796000000,CreatorFeedback1790797000000],synchronize:false,logging:false,extra:{max:12,statement_timeout:15000}});}
