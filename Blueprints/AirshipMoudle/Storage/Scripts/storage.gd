extends Node2D
class_name Storage

#region Storage属性
@export var _volum:int
@export var _current_reserves:int
@export var _objects:Array[AirshipItemDataBase]
#endregion

#region StorageKey
var _storage_is_full:bool = false
var _storage_is_empty:bool = false
#endregion

#region Storage消息
signal message_reserves_changed(last_reserves:int,current_reserves)
signal message_is_empty
signal message_is_full
#endregion

#region Storage对外接口
func send_object(object_name:StringName)->AirshipItemDataBase:
	if _storage_is_empty:
		push_warning("storage is empty!!!!!")
		return
	var index:int = 0
	for _object in _objects:
		if _object.name == object_name:
			_objects.remove_at(index)
			_delete_reserves(_object.size)
			return _object
		index = index + 1
	push_error("can not find object!!! object name: %s"%[object_name])
	return null

func add_object(object:AirshipItemDataBase)->void:
	if _storage_is_full:
		push_warning("storage is fulll!!!")
		return
	_objects.append(object)
	_add_reserves(object.size)
	
func transferring_inventory (new_storage:Storage)->void:
	new_storage._current_reserves = _current_reserves
	new_storage._objects = _objects.duplicate(true)
	_current_reserves = 0
	_objects.clear()
	_storage_is_empty = true
	_storage_is_full  = false
#endregion

#region Storage内部逻辑
func _delete_reserves(num:int)->void:
	var _last_reserves:int
	_last_reserves = _current_reserves
	_current_reserves = _current_reserves - num
	message_reserves_changed.emit(_last_reserves,_current_reserves)
	if _current_reserves == 0:
		message_is_empty.emit()
	_storage_is_full = false

func _add_reserves(num:int)->void:
	var _last_reserves:int
	_last_reserves = _current_reserves
	_current_reserves = _current_reserves + num
	message_reserves_changed.emit(_last_reserves,_current_reserves)
	if _current_reserves == _volum:
		message_is_full.emit()
	_storage_is_empty = false
#endregion

#region Storage回调函数
func _reserves_is_empty()->void:
	_storage_is_empty = true
func _reserves_is_full()->void:
	_storage_is_full = true
#endregion
