import{SqliteEventRepository}from"../lib/repository.ts";new SqliteEventRepository(process.env.EVENTS_DB_PATH||`${process.cwd()}/data/events.db`);console.log("Events database ready.");
